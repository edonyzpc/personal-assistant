/* Copyright 2023 edonyzpc */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { Platform } from "obsidian";

import { PetStateMachine } from "../src/pagelet/pet/PetStateMachine";
import { getPetAriaLabel, getPetHoldMenuLabels, PetView, resolvePetMountTarget } from "../src/pagelet/pet/PetView";

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

type HoldMenuListener = EventListenerOrEventListenerObject;

class HoldMenuFakeElement {
    className = "";
    textContent: string | null = null;
    readonly children: HoldMenuFakeElement[] = [];
    private readonly listeners = new Map<string, HoldMenuListener[]>();
    private readonly attributes = new Map<string, string>();
    private parent: HoldMenuFakeElement | null = null;

    appendChild(child: HoldMenuFakeElement): HoldMenuFakeElement {
        child.parent = this;
        this.children.push(child);
        return child;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    addEventListener(type: string, listener: HoldMenuListener, _options?: AddEventListenerOptions | boolean): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: HoldMenuListener): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
    }

    get classList(): { contains: (name: string) => boolean } {
        const cn = this.className;
        return { contains: (name: string) => cn.split(/\s+/).includes(name) };
    }

    dispatch(type: string, extra?: Partial<Event & TouchEvent>): void {
        const self = this;
        const event = {
            target: this,
            type,
            stopPropagation: jest.fn(),
            preventDefault: jest.fn(),
            composedPath: () => {
                const path: HoldMenuFakeElement[] = [];
                let node: HoldMenuFakeElement | null = self;
                while (node) { path.push(node); node = node.parent; }
                return path;
            },
            touches: [],
            changedTouches: [],
            ...extra,
        } as unknown as Event;
        for (const listener of this.listeners.get(type) ?? []) {
            if (typeof listener === "function") listener(event);
            else listener.handleEvent(event);
        }
    }

    contains(target: Node | null): boolean {
        const candidate = target as unknown as HoldMenuFakeElement | null;
        return candidate === this || this.children.some((child) => child.contains(target));
    }

    remove(): void {
        if (!this.parent) return;
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
        this.parent = null;
    }
}

class HoldMenuFakeDocument {
    private readonly listeners = new Map<string, HoldMenuListener[]>();

    createElement(): HoldMenuFakeElement {
        return new HoldMenuFakeElement();
    }

    addEventListener(type: string, listener: HoldMenuListener): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: HoldMenuListener): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
    }

    listenerCount(type: string): number {
        return (this.listeners.get(type) ?? []).length;
    }
}

function withHoldMenuDocument(run: (doc: HoldMenuFakeDocument) => void): void {
    const globals = globalThis as typeof globalThis & {
        activeDocument?: Document;
        document?: Document;
    };
    const originalActiveDocument = globals.activeDocument;
    const originalDocument = globals.document;
    const doc = new HoldMenuFakeDocument();
    Object.defineProperty(globals, "activeDocument", {
        configurable: true,
        writable: true,
        value: doc as unknown as Document,
    });
    Object.defineProperty(globals, "document", {
        configurable: true,
        writable: true,
        value: doc as unknown as Document,
    });
    try {
        run(doc);
    } finally {
        Object.defineProperty(globals, "activeDocument", {
            configurable: true,
            writable: true,
            value: originalActiveDocument,
        });
        Object.defineProperty(globals, "document", {
            configurable: true,
            writable: true,
            value: originalDocument,
        });
    }
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

    it("localizes the three long-press actions", () => {
        expect(getPetHoldMenuLabels("en")).toEqual({
            capture: "Capture",
            review: "Review",
            discover: "Discover",
        });
        expect(getPetHoldMenuLabels("zh")).toEqual({
            capture: "随手记下",
            review: "审阅",
            discover: "发现关联",
        });
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

    it("defines a 520ms hold gesture for the three-action menu", () => {
        const source = readFileSync("src/pagelet/pet/PetView.ts", "utf8");

        expect(source).toContain("const QUICK_CAPTURE_HOLD_MS = 520;");
        expect(source).toContain("onQuickCaptureOpen");
        expect(source).toContain("onReviewCurrentNote");
        expect(source).toContain("onDiscoverConnections");
        expect(source).toContain("this.showHoldMenu();");
        expect(source).toContain("_handleMouseDown");
        expect(source).toContain("_handleTouchstart");
        expect(source).toContain("_handleTouchcancel");
        expect(source).toContain("this.startQuickCaptureHold();");
        expect(source).toContain("if (this.consumeQuickCaptureHold()) return;");
        expect(source).not.toContain("pa-pagelet-pet-capture-form");
        expect(source).not.toContain("pagelet.pet.quickCapturePlaceholder");
    });

    it("marks hold triggered from the hold path without calling the bubble callback", () => {
        jest.useFakeTimers();
        type PetViewCaptureInternals = {
            startQuickCaptureHold: () => void;
            _quickCaptureHoldTriggered: boolean;
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

        expect(internals._quickCaptureHoldTriggered).toBe(true);
        expect(onToggleBubble).not.toHaveBeenCalled();
    });

    it("routes every hold-menu button to its exact callback without toggling Bubble", () => {
        jest.useFakeTimers();
        withHoldMenuDocument(() => {
            const onToggleBubble = jest.fn();
            const callbacks = [jest.fn(), jest.fn(), jest.fn()];
            const view = new PetView({
                callbacks: {
                    onToggleBubble,
                    onQuickCaptureOpen: callbacks[0],
                    onReviewCurrentNote: callbacks[1],
                    onDiscoverConnections: callbacks[2],
                },
                getLocale: () => "en",
            });
            const root = new HoldMenuFakeElement();
            const internals = view as unknown as {
                _rootEl: HTMLElement | null;
                startQuickCaptureHold: () => void;
            };
            internals._rootEl = root as unknown as HTMLElement;

            for (let index = 0; index < callbacks.length; index += 1) {
                internals.startQuickCaptureHold();
                jest.advanceTimersByTime(520);
                const menu = root.children.find((child) => child.className === "pa-pagelet-pet-hold-menu");
                expect(menu?.children.map((item) => item.textContent)).toEqual([
                    "Capture",
                    "Review",
                    "Discover",
                ]);

                menu?.children[index]?.dispatch("click");

                expect(callbacks[index]).toHaveBeenCalledTimes(1);
                expect(onToggleBubble).not.toHaveBeenCalled();
                expect(root.children).toHaveLength(0);
            }

            view.unmount();
        });
    });

    it("routes menu-origin touch events to target callback without toggling Pet root", () => {
        jest.useFakeTimers();
        withHoldMenuDocument(() => {
            const onToggleBubble = jest.fn();
            const onCapture = jest.fn();
            const onReview = jest.fn();
            const onDiscover = jest.fn();
            const view = new PetView({
                callbacks: {
                    onToggleBubble,
                    onQuickCaptureOpen: onCapture,
                    onReviewCurrentNote: onReview,
                    onDiscoverConnections: onDiscover,
                },
                getLocale: () => "en",
            });
            const root = new HoldMenuFakeElement();
            const internals = view as unknown as {
                _rootEl: HTMLElement | null;
                startQuickCaptureHold: () => void;
            };
            internals._rootEl = root as unknown as HTMLElement;

            const allCallbacks = [onCapture, onReview, onDiscover];
            for (let index = 0; index < allCallbacks.length; index += 1) {
                onToggleBubble.mockClear();
                allCallbacks.forEach((cb) => cb.mockClear());

                internals.startQuickCaptureHold();
                jest.advanceTimersByTime(520);
                const menu = root.children.find((child) => child.className === "pa-pagelet-pet-hold-menu");
                const btn = menu?.children[index];
                expect(btn).toBeDefined();

                const touch = { clientX: 100, clientY: 200 };
                btn!.dispatch("touchstart", { touches: [touch] } as never);
                btn!.dispatch("touchend", {
                    touches: [],
                    changedTouches: [touch],
                } as never);

                expect(allCallbacks[index]).toHaveBeenCalledTimes(1);
                expect(onToggleBubble).not.toHaveBeenCalled();
                expect(root.children.filter((c) => c.className === "pa-pagelet-pet-hold-menu")).toHaveLength(0);
            }
            view.unmount();
        });
    });

    it("prevents duplicate callback when synthetic click follows touch on menu item", () => {
        jest.useFakeTimers();
        withHoldMenuDocument(() => {
            const onToggleBubble = jest.fn();
            const onCapture = jest.fn();
            const view = new PetView({
                callbacks: {
                    onToggleBubble,
                    onQuickCaptureOpen: onCapture,
                },
                getLocale: () => "en",
            });
            const root = new HoldMenuFakeElement();
            const internals = view as unknown as {
                _rootEl: HTMLElement | null;
                startQuickCaptureHold: () => void;
            };
            internals._rootEl = root as unknown as HTMLElement;

            internals.startQuickCaptureHold();
            jest.advanceTimersByTime(520);
            const menu = root.children.find((child) => child.className === "pa-pagelet-pet-hold-menu");
            const btn = menu?.children[0];

            const touch = { clientX: 100, clientY: 200 };
            btn!.dispatch("touchstart", { touches: [touch] } as never);
            btn!.dispatch("touchend", { touches: [], changedTouches: [touch] } as never);
            btn!.dispatch("click");

            expect(onCapture).toHaveBeenCalledTimes(1);
            expect(onToggleBubble).not.toHaveBeenCalled();
            view.unmount();
        });
    });

    it("cancels menu item callback on touchcancel", () => {
        jest.useFakeTimers();
        withHoldMenuDocument(() => {
            const onCapture = jest.fn();
            const onToggleBubble = jest.fn();
            const view = new PetView({
                callbacks: { onToggleBubble, onQuickCaptureOpen: onCapture },
                getLocale: () => "en",
            });
            const root = new HoldMenuFakeElement();
            const internals = view as unknown as {
                _rootEl: HTMLElement | null;
                startQuickCaptureHold: () => void;
            };
            internals._rootEl = root as unknown as HTMLElement;

            internals.startQuickCaptureHold();
            jest.advanceTimersByTime(520);
            const btn = root.children
                .find((c) => c.className === "pa-pagelet-pet-hold-menu")
                ?.children[0];

            btn!.dispatch("touchstart", { touches: [{ clientX: 0, clientY: 0 }] } as never);
            btn!.dispatch("touchcancel");

            expect(onCapture).not.toHaveBeenCalled();
            expect(onToggleBubble).not.toHaveBeenCalled();
            view.unmount();
        });
    });

    it("cancels menu item callback on movement exceeding 12px", () => {
        jest.useFakeTimers();
        withHoldMenuDocument(() => {
            const onCapture = jest.fn();
            const onToggleBubble = jest.fn();
            const view = new PetView({
                callbacks: { onToggleBubble, onQuickCaptureOpen: onCapture },
                getLocale: () => "en",
            });
            const root = new HoldMenuFakeElement();
            const internals = view as unknown as {
                _rootEl: HTMLElement | null;
                startQuickCaptureHold: () => void;
            };
            internals._rootEl = root as unknown as HTMLElement;

            internals.startQuickCaptureHold();
            jest.advanceTimersByTime(520);
            const btn = root.children
                .find((c) => c.className === "pa-pagelet-pet-hold-menu")
                ?.children[0];

            const start = { clientX: 100, clientY: 100 };
            btn!.dispatch("touchstart", { touches: [start] } as never);
            btn!.dispatch("touchend", {
                touches: [],
                changedTouches: [{ clientX: 115, clientY: 100 }],
            } as never);

            expect(onCapture).not.toHaveBeenCalled();
            expect(onToggleBubble).not.toHaveBeenCalled();
            view.unmount();
        });
    });

    it("executes menu item callback via keyboard Enter without Pet root toggle", () => {
        jest.useFakeTimers();
        withHoldMenuDocument(() => {
            const onCapture = jest.fn();
            const onToggleBubble = jest.fn();
            const view = new PetView({
                callbacks: { onToggleBubble, onQuickCaptureOpen: onCapture },
                getLocale: () => "en",
            });
            const root = new HoldMenuFakeElement();
            const internals = view as unknown as {
                _rootEl: HTMLElement | null;
                startQuickCaptureHold: () => void;
            };
            internals._rootEl = root as unknown as HTMLElement;

            internals.startQuickCaptureHold();
            jest.advanceTimersByTime(520);
            const btn = root.children
                .find((c) => c.className === "pa-pagelet-pet-hold-menu")
                ?.children[0];

            btn!.dispatch("keydown", { key: "Enter" } as never);

            expect(onCapture).toHaveBeenCalledTimes(1);
            expect(onToggleBubble).not.toHaveBeenCalled();
            view.unmount();
        });
    });

    it("clears a pending or visible hold menu when unmounted between leaves", () => {
        jest.useFakeTimers();
        withHoldMenuDocument((doc) => {
            const view = new PetView({
                callbacks: {
                    onToggleBubble: jest.fn(),
                    onQuickCaptureOpen: jest.fn(),
                    onReviewCurrentNote: jest.fn(),
                    onDiscoverConnections: jest.fn(),
                },
            });
            const firstRoot = new HoldMenuFakeElement();
            const internals = view as unknown as {
                _rootEl: HTMLElement | null;
                _quickCaptureHoldTriggered: boolean;
                startQuickCaptureHold: () => void;
            };
            internals._rootEl = firstRoot as unknown as HTMLElement;

            internals.startQuickCaptureHold();
            jest.advanceTimersByTime(519);
            view.unmount();

            const nextRoot = new HoldMenuFakeElement();
            internals._rootEl = nextRoot as unknown as HTMLElement;
            jest.advanceTimersByTime(1);
            expect(nextRoot.children).toHaveLength(0);
            expect(internals._quickCaptureHoldTriggered).toBe(false);
            expect(jest.getTimerCount()).toBe(0);

            internals.startQuickCaptureHold();
            jest.advanceTimersByTime(520);
            expect(nextRoot.children).toHaveLength(1);
            expect(doc.listenerCount("pointerdown")).toBe(1);

            view.unmount();

            expect(nextRoot.children).toHaveLength(0);
            expect(doc.listenerCount("pointerdown")).toBe(0);
            expect(internals._quickCaptureHoldTriggered).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        });
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

    it("cancels an in-progress hold when the platform cancels the touch", () => {
        jest.useFakeTimers();
        type PetViewHoldInternals = {
            startQuickCaptureHold: () => void;
            _handleTouchcancel: () => void;
            _quickCaptureHoldTriggered: boolean;
        };
        const view = new PetView({
            callbacks: {
                onToggleBubble: jest.fn(),
                onQuickCaptureOpen: jest.fn(),
            },
        });
        const internals = view as unknown as PetViewHoldInternals;

        internals.startQuickCaptureHold();
        internals._handleTouchcancel();
        jest.advanceTimersByTime(520);

        expect(internals._quickCaptureHoldTriggered).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });
});

describe("PetView mobile toolbar mounting", () => {
    function makeMountFixture(options: {
        mobile: boolean;
        width: number;
        height: number;
        toolbar: boolean;
    }) {
        const sidebarToggle = { parentElement: null as unknown };
        const toolbarLeft = {
            querySelector: jest.fn((selector: string) => (
                selector === ".sidebar-toggle-button.mod-left" ? sidebarToggle : null
            )),
        };
        sidebarToggle.parentElement = toolbarLeft;
        const leafContent = {
            querySelector: jest.fn((selector: string) => (
                options.toolbar && selector === ".view-header-left" ? toolbarLeft : null
            )),
        };
        const ownerDocument = {
            body: {
                classList: {
                    contains: (className: string) => options.mobile && className === "is-mobile",
                },
            },
            documentElement: {
                clientWidth: options.width,
                clientHeight: options.height,
            },
            defaultView: {
                innerWidth: options.width,
                innerHeight: options.height,
            },
        };
        const containerEl = {
            ownerDocument,
            closest: jest.fn((selector: string) => (
                selector === ".workspace-leaf-content" ? leafContent : null
            )),
        };
        return {
            containerEl: containerEl as unknown as HTMLElement,
            leafContent: leafContent as unknown as HTMLElement,
            toolbarLeft: toolbarLeft as unknown as HTMLElement,
            sidebarToggle: sidebarToggle as unknown as HTMLElement,
        };
    }

    it("anchors a phone pet beside the current Markdown leaf sidebar toggle", () => {
        const fixture = makeMountFixture({ mobile: true, width: 390, height: 844, toolbar: true });

        const target = resolvePetMountTarget(fixture.containerEl);

        expect(target).toEqual({
            mountEl: fixture.toolbarLeft,
            insertAfterEl: fixture.sidebarToggle,
            mobileToolbar: true,
        });
    });

    it("keeps the toolbar anchor when the phone rotates to landscape", () => {
        const fixture = makeMountFixture({ mobile: true, width: 844, height: 390, toolbar: true });

        expect(resolvePetMountTarget(fixture.containerEl).mobileToolbar).toBe(true);
    });

    it("does not treat a narrow iPad split as an iPhone", () => {
        const platform = Platform as unknown as { isDesktop: boolean; isPhone: boolean };
        const originalDesktop = platform.isDesktop;
        const originalPhone = platform.isPhone;
        platform.isDesktop = false;
        platform.isPhone = false;
        const fixture = makeMountFixture({ mobile: true, width: 500, height: 1024, toolbar: true });

        try {
            expect(resolvePetMountTarget(fixture.containerEl).mobileToolbar).toBe(false);
        } finally {
            platform.isDesktop = originalDesktop;
            platform.isPhone = originalPhone;
        }
    });

    it("uses the native phone signal regardless of orientation dimensions", () => {
        const platform = Platform as unknown as { isDesktop: boolean; isPhone: boolean };
        const originalDesktop = platform.isDesktop;
        const originalPhone = platform.isPhone;
        platform.isDesktop = false;
        platform.isPhone = true;
        const fixture = makeMountFixture({ mobile: true, width: 1024, height: 768, toolbar: true });

        try {
            expect(resolvePetMountTarget(fixture.containerEl).mobileToolbar).toBe(true);
        } finally {
            platform.isDesktop = originalDesktop;
            platform.isPhone = originalPhone;
        }
    });

    it("falls back to the current note content instead of document.body", () => {
        const fixture = makeMountFixture({ mobile: true, width: 390, height: 844, toolbar: false });

        expect(resolvePetMountTarget(fixture.containerEl)).toEqual({
            mountEl: fixture.containerEl,
            insertAfterEl: null,
            mobileToolbar: false,
        });
    });

    it("keeps desktop pets in the Markdown content container", () => {
        const fixture = makeMountFixture({ mobile: false, width: 1440, height: 900, toolbar: true });

        expect(resolvePetMountTarget(fixture.containerEl).mountEl).toBe(fixture.containerEl);
    });

    it("inserts toolbar pets after the native left toggle and marks their placement", () => {
        const source = readFileSync("src/pagelet/pet/PetView.ts", "utf8");

        expect(source).toContain('root.classList.add("pa-pagelet-pet--mobile-toolbar")');
        expect(source).toContain("mountEl.insertBefore(root, mountTarget.insertAfterEl.nextSibling)");
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

    it("lets the phone Pet follow the active leaf toolbar instead of the viewport", () => {
        const css = readFileSync("src/custom.pcss", "utf8");
        const selector = "body.is-mobile .pa-pagelet-pet--mobile-toolbar";
        const mobileTopbarBlock = getCssRuleBlock(css, selector);
        const mobileCornerOverrideBlock = getCssRuleBlock(css, `${selector}[data-corner]`);
        const mobileWrapperBlock = getCssRuleBlock(css, `${selector} .pa-pagelet-pet-wrapper`);
        const mobileSvgBlock = getCssRuleBlock(css, `${selector} .pa-pagelet-pet-svg-wrap svg`);
        const mobileOutlineStrokeBlock = getCssRuleBlock(css, `${selector} .pa-pagelet-pet-stroke-outline`);
        const mobileDetailStrokeBlock = getCssRuleBlock(css, `${selector} .pa-pagelet-pet-stroke-detail`);
        const mobileRestingBlock = getCssRuleBlock(css, `${selector}[data-state=resting]`);
        const mobileRestingSvgWrapBlock = getCssRuleBlock(css, `${selector}[data-state=resting] .pa-pagelet-pet-svg-wrap`);

        expect(mobileTopbarBlock).toContain("position: relative;");
        expect(mobileTopbarBlock).not.toContain("position: fixed;");
        expect(mobileTopbarBlock).toContain("width: 44px;");
        expect(mobileTopbarBlock).toContain("height: 44px;");
        expect(mobileTopbarBlock).toContain("flex: 0 0 44px;");
        expect(mobileTopbarBlock).toContain("display: flex;");
        expect(mobileTopbarBlock).toContain("align-items: center;");
        expect(mobileTopbarBlock).toContain("justify-content: center;");
        expect(mobileTopbarBlock).toContain("right: auto;");
        expect(mobileTopbarBlock).toContain("bottom: auto;");
        expect(mobileTopbarBlock).toContain("z-index: auto;");
        expect(css).not.toContain("--pa-pagelet-mobile-topbar-pet-top");
        expect(css).not.toContain("--pa-pagelet-mobile-topbar-pet-left");
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
        expect(mobileRestingBlock).toContain("opacity: 0.8;");
        expect(mobileRestingBlock).toContain("filter: none;");
        expect(mobileRestingSvgWrapBlock).toContain("filter: none;");
    });

    it("preserves existing Pagelet motion while disabling the hold-menu entrance for reduced motion", () => {
        const css = readFileSync("src/custom.pcss", "utf8");
        const pageletMotionStart = css.indexOf("body.is-mobile .pa-pagelet-tab-body");
        const pageletMascotStart = css.indexOf("Pagelet (Review Assistant) — mascot", pageletMotionStart);
        expect(pageletMotionStart).toBeGreaterThan(-1);
        expect(pageletMascotStart).toBeGreaterThan(pageletMotionStart);

        const pageletMotionCss = css.slice(pageletMotionStart, pageletMascotStart);

        expect(pageletMotionCss).not.toContain("prefers-reduced-motion");
        expect(pageletMotionCss).not.toContain("transition-duration: .01s!important");
        expect(pageletMotionCss).not.toContain("animation: none!important");
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.pa-pagelet-pet-hold-menu \{[\s\S]*?animation:\s*none;/);
    });

    it("places the phone hold menu below the toolbar and keeps every action touch-sized", () => {
        const css = readFileSync("src/custom.pcss", "utf8");
        const menuBlock = getCssRuleBlock(
            css,
            "body.is-mobile .pa-pagelet-pet--mobile-toolbar .pa-pagelet-pet-hold-menu",
        );
        const itemBlock = getCssRuleBlock(
            css,
            "body.is-mobile .pa-pagelet-pet-hold-menu-item",
        );

        expect(menuBlock).toContain("top: calc(100% + 8px);");
        expect(menuBlock).toContain("bottom: auto;");
        expect(itemBlock).toContain("min-width: 44px;");
        expect(itemBlock).toContain("min-height: 44px;");
    });
});
