/* Copyright 2023 edonyzpc */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";

import {
    computeActionRingLayout,
    getPetActionRingLabels,
    intersectActionRingViewport,
    PetView,
} from "../src/pagelet/pet/PetView";
import type {
    ActionRingItemPosition,
    ActionRingItemSize,
    ActionRingLayoutRect,
} from "../src/pagelet/pet/PetView";

type Listener = EventListenerOrEventListenerObject;

class FakeElement {
    id = "";
    className = "";
    textContent: string | null = null;
    readonly children: FakeElement[] = [];
    readonly ownerDocument: FakeDocument;
    focusCount = 0;
    private readonly attributes = new Map<string, string>();
    private readonly listeners = new Map<string, Listener[]>();
    private parent: FakeElement | null = null;

    constructor(ownerDocument: FakeDocument) {
        this.ownerDocument = ownerDocument;
    }

    appendChild(child: FakeElement): FakeElement {
        child.parent = this;
        this.children.push(child);
        return child;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    addEventListener(type: string, listener: Listener): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
    }

    contains(target: Node | null): boolean {
        const candidate = target as unknown as FakeElement | null;
        return candidate === this || this.children.some((child) => child.contains(target));
    }

    querySelector(selector: string): FakeElement | null {
        if (selector !== "button:not([disabled])") return null;
        return this.children.find((child) =>
            child.getAttribute("type") === "button"
            && child.getAttribute("disabled") === null
        ) ?? null;
    }

    focus(): void {
        this.focusCount += 1;
        this.ownerDocument.activeElement = this;
    }

    remove(): void {
        if (!this.parent) return;
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
        this.parent = null;
    }

    dispatch(type: string, extra: Record<string, unknown> = {}): Event {
        const path: FakeElement[] = [];
        let current: FakeElement | null = this;
        while (current) {
            path.push(current);
            current = current.parent;
        }
        let stopped = false;
        let defaultPrevented = false;
        const event = {
            type,
            target: this,
            currentTarget: this,
            get defaultPrevented() {
                return defaultPrevented;
            },
            preventDefault: () => {
                defaultPrevented = true;
            },
            stopPropagation: () => {
                stopped = true;
            },
            composedPath: () => path,
            touches: [],
            changedTouches: [],
            ...extra,
        } as unknown as Event & { currentTarget: FakeElement };
        this.ownerDocument.dispatchCaptured(type, event);
        for (const node of path) {
            event.currentTarget = node as unknown as EventTarget & FakeElement;
            for (const listener of node.listeners.get(type) ?? []) {
                if (typeof listener === "function") listener(event);
                else listener.handleEvent(event);
            }
            if (stopped) break;
        }
        return event;
    }
}

class FakeDocument {
    readonly body = new FakeElement(this);
    readonly documentElement = new FakeElement(this);
    activeElement: FakeElement | null = null;
    private readonly listeners = new Map<string, Listener[]>();

    createElement(): FakeElement {
        return new FakeElement(this);
    }

    addEventListener(type: string, listener: Listener): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
    }

    dispatchCaptured(type: string, event: Event): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            if (typeof listener === "function") listener(event);
            else listener.handleEvent(event);
        }
    }

    dispatchOutside(type: string, extra: Record<string, unknown> = {}): void {
        const target = this.createElement();
        this.dispatchCaptured(type, {
            type,
            target,
            touches: [],
            changedTouches: [],
            ...extra,
        } as unknown as Event);
        if (type === "pointerdown") target.focus();
    }

    listenerCount(type: string): number {
        return (this.listeners.get(type) ?? []).length;
    }
}

type Fixture = {
    doc: FakeDocument;
    root: FakeElement;
    view: PetView;
    onToggleBubble: jest.Mock;
    onCapture: jest.Mock;
    onReview: jest.Mock;
    onDiscover: jest.Mock;
    onWillOpen: jest.Mock;
    onClosed: jest.Mock;
};

function withFixture(run: (fixture: Fixture) => void): void {
    jest.useFakeTimers();
    const globals = globalThis as typeof globalThis & { activeDocument?: Document };
    const previousDocument = globals.activeDocument;
    const doc = new FakeDocument();
    Object.defineProperty(globals, "activeDocument", {
        configurable: true,
        writable: true,
        value: doc as unknown as Document,
    });
    const root = doc.createElement();
    const onToggleBubble = jest.fn();
    const onCapture = jest.fn();
    const onReview = jest.fn();
    const onDiscover = jest.fn();
    const onWillOpen = jest.fn();
    const onClosed = jest.fn();
    const view = new PetView({
        callbacks: {
            onToggleBubble,
            onQuickCaptureOpen: onCapture,
            onReviewCurrentNote: onReview,
            onDiscoverConnections: onDiscover,
            onActionRingWillOpen: onWillOpen,
            onActionRingClosed: onClosed,
        },
        getLocale: () => "zh",
    });
    const internals = view as unknown as {
        _rootEl: HTMLElement | null;
        _handleClick: EventListener;
        _handleKeydown: EventListener;
        _handlePointerDown: EventListener;
        _handlePointerMove: EventListener;
        _handlePointerUp: EventListener;
        _handlePointerCancel: EventListener;
        _handlePointerLeave: EventListener;
        _handleTouchstart: EventListener;
        _handleTouchmove: EventListener;
        _handleTouchend: EventListener;
        _handleTouchcancel: EventListener;
    };
    internals._rootEl = root as unknown as HTMLElement;
    root.addEventListener("click", internals._handleClick);
    root.addEventListener("keydown", internals._handleKeydown);
    root.addEventListener("pointerdown", internals._handlePointerDown);
    root.addEventListener("pointermove", internals._handlePointerMove);
    root.addEventListener("pointerup", internals._handlePointerUp);
    root.addEventListener("pointercancel", internals._handlePointerCancel);
    root.addEventListener("pointerleave", internals._handlePointerLeave);
    root.addEventListener("touchstart", internals._handleTouchstart);
    root.addEventListener("touchmove", internals._handleTouchmove);
    root.addEventListener("touchend", internals._handleTouchend);
    root.addEventListener("touchcancel", internals._handleTouchcancel);

    try {
        run({
            doc,
            root,
            view,
            onToggleBubble,
            onCapture,
            onReview,
            onDiscover,
            onWillOpen,
            onClosed,
        });
    } finally {
        view.destroy();
        Object.defineProperty(globals, "activeDocument", {
            configurable: true,
            writable: true,
            value: previousDocument,
        });
    }
}

function ringOf(root: FakeElement): FakeElement {
    const ring = root.children.find((child) => child.className === "pa-pagelet-action-ring");
    if (!ring) throw new Error("Expected Action Ring.");
    return ring;
}

afterEach(() => {
    jest.useRealTimers();
});

describe("Pet Action Ring public lifecycle", () => {
    it("uses a stable accessible group, fixed action order, and first-item focus", () => {
        withFixture(({ doc, root, view, onWillOpen, onClosed }) => {
            view.openActionRing();
            const ring = ringOf(root);
            const firstId = ring.id;

            expect(view.actionRingOpen).toBe(true);
            expect(ring.getAttribute("role")).toBe("group");
            expect(ring.getAttribute("aria-label")).toBe("拾页操作");
            expect(ring.children.map((item) => item.textContent)).toEqual([
                "随手记下",
                "审阅",
                "发现关联",
            ]);
            expect(doc.activeElement).toBe(ring.children[0]);
            expect(root.getAttribute("aria-expanded")).toBe("true");
            expect(onWillOpen).toHaveBeenCalledTimes(1);

            view.closeActionRing(true);
            expect(view.actionRingOpen).toBe(false);
            expect(root.getAttribute("aria-expanded")).toBe("false");
            expect(doc.activeElement).toBe(root);
            expect(onClosed).toHaveBeenLastCalledWith("passive");

            view.openActionRing();
            expect(ringOf(root).id).toBe(firstId);
        });
    });

    it("closes before each action, executes exactly once, and leaves focus to the target", () => {
        withFixture(({ doc, root, view, onCapture, onToggleBubble, onClosed }) => {
            view.openActionRing();
            const capture = ringOf(root).children[0];
            capture.dispatch("click");
            capture.dispatch("click");

            expect(view.actionRingOpen).toBe(false);
            expect(onCapture).toHaveBeenCalledTimes(1);
            expect(onToggleBubble).not.toHaveBeenCalled();
            expect(onClosed).toHaveBeenCalledWith("action");
            expect(doc.activeElement).toBe(capture);
            expect(root.focusCount).toBe(0);
        });
    });

    it("refreshes the inactivity timer when a long press repeats while open", () => {
        withFixture(({ root, view, onWillOpen, onClosed }) => {
            view.openActionRing();
            jest.advanceTimersByTime(2000);
            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 10,
                clientY: 10,
            });
            jest.advanceTimersByTime(520);
            root.dispatch("pointerup", {
                pointerId: 1,
                isPrimary: true,
                clientX: 10,
                clientY: 10,
            });
            root.dispatch("click");

            expect(onWillOpen).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(2999);
            expect(view.actionRingOpen).toBe(true);
            jest.advanceTimersByTime(1);
            expect(view.actionRingOpen).toBe(false);
            expect(onClosed).toHaveBeenCalledWith("passive");
        });
    });

    it("keeps native Tab and Shift+Tab traversal while treating both as activity", () => {
        withFixture(({ root, view }) => {
            view.openActionRing();
            const first = ringOf(root).children[0];

            jest.advanceTimersByTime(2500);
            const forward = first.dispatch("keydown", { key: "Tab" });
            expect(forward.defaultPrevented).toBe(false);
            jest.advanceTimersByTime(2500);
            const reverse = first.dispatch("keydown", { key: "Tab", shiftKey: true });
            expect(reverse.defaultPrevented).toBe(false);
            jest.advanceTimersByTime(2999);
            expect(view.actionRingOpen).toBe(true);
            jest.advanceTimersByTime(1);
            expect(view.actionRingOpen).toBe(false);
        });
    });

    it("supports unconditional context keys and passive Escape/outside close", () => {
        withFixture(({ doc, root, view, onToggleBubble, onWillOpen }) => {
            root.dispatch("keydown", { key: "F10", shiftKey: true });
            expect(view.actionRingOpen).toBe(true);
            ringOf(root).children[0].dispatch("keydown", { key: "Escape" });
            expect(view.actionRingOpen).toBe(false);
            expect(doc.activeElement).not.toBe(root);
            jest.advanceTimersByTime(0);
            expect(doc.activeElement).toBe(root);

            root.dispatch("keydown", { key: "ContextMenu" });
            expect(view.actionRingOpen).toBe(true);
            doc.dispatchOutside("pointerdown");
            expect(view.actionRingOpen).toBe(false);
            expect(doc.activeElement).not.toBe(root);
            jest.advanceTimersByTime(0);
            expect(doc.activeElement).toBe(root);
            expect(onWillOpen).toHaveBeenCalledTimes(2);
            expect(onToggleBubble).not.toHaveBeenCalled();
            expect(doc.listenerCount("pointerdown")).toBe(0);
        });
    });

    it("cancels delayed outside-focus restoration when unmounted", () => {
        withFixture(({ doc, root, view }) => {
            view.openActionRing();
            doc.dispatchOutside("pointerdown");
            expect(root.focusCount).toBe(0);

            view.unmount();
            jest.advanceTimersByTime(0);

            expect(root.focusCount).toBe(0);
            expect(jest.getTimerCount()).toBe(0);
        });
    });
});

describe("Pet root gesture ownership", () => {
    it("runs a short pointer activation once and permanently cancels a crossed trajectory", () => {
        withFixture(({ root, onToggleBubble }) => {
            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("pointerup", {
                pointerId: 1,
                isPrimary: true,
                clientX: 8,
                clientY: 8,
            });
            root.dispatch("click");
            expect(onToggleBubble).toHaveBeenCalledTimes(1);

            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 2,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("pointermove", {
                pointerId: 2,
                isPrimary: true,
                clientX: 13,
                clientY: 0,
            });
            root.dispatch("pointermove", {
                pointerId: 2,
                isPrimary: true,
                clientX: 1,
                clientY: 0,
            });
            root.dispatch("pointerup", {
                pointerId: 2,
                isPrimary: true,
                clientX: 1,
                clientY: 0,
            });
            root.dispatch("click");
            expect(onToggleBubble).toHaveBeenCalledTimes(1);
        });
    });

    it("runs single-touch once while suppressing its synthetic click", () => {
        withFixture(({ root, onToggleBubble }) => {
            const touch = { identifier: 7, clientX: 20, clientY: 20 };
            root.dispatch("touchstart", { touches: [touch] });
            root.dispatch("touchend", { touches: [], changedTouches: [touch] });
            root.dispatch("click");

            expect(onToggleBubble).toHaveBeenCalledTimes(1);
        });
    });

    it("cancels hold on a second touch, pointer leave, and unmount", () => {
        withFixture(({ root, view, onToggleBubble }) => {
            const first = { identifier: 1, clientX: 0, clientY: 0 };
            const second = { identifier: 2, clientX: 2, clientY: 0 };
            root.dispatch("touchstart", { touches: [first] });
            root.dispatch("touchstart", { touches: [first, second] });
            root.dispatch("touchend", { touches: [], changedTouches: [first] });
            root.dispatch("click");

            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 3,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("pointerleave", { pointerId: 3 });
            root.dispatch("click");
            expect(onToggleBubble).not.toHaveBeenCalled();

            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 4,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            jest.advanceTimersByTime(519);
            view.unmount();
            jest.advanceTimersByTime(1);
            expect(view.actionRingOpen).toBe(false);
            expect(jest.getTimerCount()).toBe(0);
        });
    });

    it("permanently cancels pointer/touch gestures after a second pointer or cancel event", () => {
        withFixture(({ root, view, onToggleBubble, onWillOpen }) => {
            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 2,
                pointerType: "mouse",
                isPrimary: false,
                clientX: 1,
                clientY: 0,
            });
            root.dispatch("pointerup", {
                pointerId: 1,
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("click");

            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 3,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("pointercancel", { pointerId: 3 });
            jest.advanceTimersByTime(520);
            root.dispatch("pointerup", {
                pointerId: 3,
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("click");

            const touch = { identifier: 4, clientX: 0, clientY: 0 };
            root.dispatch("touchstart", { touches: [touch] });
            root.dispatch("touchcancel", { touches: [], changedTouches: [touch] });
            jest.advanceTimersByTime(520);
            root.dispatch("touchend", { touches: [], changedTouches: [touch] });
            root.dispatch("click");

            expect(onToggleBubble).not.toHaveBeenCalled();
            expect(onWillOpen).not.toHaveBeenCalled();
            expect(view.actionRingOpen).toBe(false);
        });
    });

    it.each([
        "pointermove",
        "pointercancel",
        "pointerleave",
    ] as const)("rolls back a newly opened Ring when %s cancels the hold before release", (eventType) => {
        withFixture(({ doc, root, view, onToggleBubble, onWillOpen, onClosed }) => {
            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            jest.advanceTimersByTime(520);
            expect(view.actionRingOpen).toBe(true);

            root.dispatch(eventType, eventType === "pointermove"
                ? {
                    pointerId: 1,
                    isPrimary: true,
                    clientX: 13,
                    clientY: 0,
                }
                : { pointerId: 1 });
            root.dispatch("pointerup", {
                pointerId: 1,
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("click");
            jest.advanceTimersByTime(0);

            expect(view.actionRingOpen).toBe(false);
            expect(onWillOpen).toHaveBeenCalledTimes(1);
            expect(onClosed).toHaveBeenCalledTimes(1);
            expect(onToggleBubble).not.toHaveBeenCalled();
            expect(doc.activeElement).toBe(root);
            expect(doc.listenerCount("pointerdown")).toBe(0);
        });
    });

    it.each([
        "touchmove",
        "touchcancel",
    ] as const)("rolls back a newly opened Ring when %s cancels the touch hold before release", (eventType) => {
        withFixture(({ doc, root, view, onToggleBubble, onWillOpen, onClosed }) => {
            const touch = { identifier: 1, clientX: 0, clientY: 0 };
            root.dispatch("touchstart", { touches: [touch] });
            jest.advanceTimersByTime(520);
            expect(view.actionRingOpen).toBe(true);

            if (eventType === "touchmove") {
                root.dispatch("touchmove", {
                    touches: [{ ...touch, clientX: 13 }],
                });
                root.dispatch("touchend", {
                    touches: [],
                    changedTouches: [touch],
                });
            } else {
                root.dispatch("touchcancel", {
                    touches: [],
                    changedTouches: [touch],
                });
            }
            root.dispatch("click");
            jest.advanceTimersByTime(0);

            expect(view.actionRingOpen).toBe(false);
            expect(onWillOpen).toHaveBeenCalledTimes(1);
            expect(onClosed).toHaveBeenCalledTimes(1);
            expect(onToggleBubble).not.toHaveBeenCalled();
            expect(doc.activeElement).toBe(root);
            expect(doc.listenerCount("pointerdown")).toBe(0);
            expect(doc.listenerCount("touchstart")).toBe(0);
        });
    });

    it("cancels the root hold when a second pointer or touch starts outside the Pet", () => {
        withFixture(({ doc, root, view, onToggleBubble, onWillOpen }) => {
            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            expect(doc.listenerCount("pointerdown")).toBe(1);
            doc.dispatchOutside("pointerdown", {
                button: 0,
                pointerId: 2,
                pointerType: "mouse",
                isPrimary: false,
                clientX: 100,
                clientY: 100,
            });
            jest.advanceTimersByTime(520);
            root.dispatch("pointerup", {
                pointerId: 1,
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("click");

            const first = { identifier: 3, clientX: 0, clientY: 0 };
            const second = { identifier: 4, clientX: 100, clientY: 100 };
            root.dispatch("touchstart", { touches: [first] });
            expect(doc.listenerCount("touchstart")).toBe(1);
            doc.dispatchOutside("touchstart", { touches: [first, second] });
            jest.advanceTimersByTime(520);
            root.dispatch("touchend", { touches: [], changedTouches: [first] });
            root.dispatch("click");

            expect(onToggleBubble).not.toHaveBeenCalled();
            expect(onWillOpen).not.toHaveBeenCalled();
            expect(view.actionRingOpen).toBe(false);
            expect(doc.listenerCount("pointerdown")).toBe(0);
            expect(doc.listenerCount("touchstart")).toBe(0);
        });
    });

    it("closes a Ring if a second pointer lands before the opening hold is released", () => {
        withFixture(({ doc, root, view, onToggleBubble, onWillOpen, onClosed }) => {
            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            jest.advanceTimersByTime(520);

            expect(view.actionRingOpen).toBe(true);
            expect(doc.listenerCount("pointerdown")).toBe(2);

            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 2,
                pointerType: "mouse",
                isPrimary: false,
                clientX: 1,
                clientY: 0,
            });
            root.dispatch("pointerup", {
                pointerId: 1,
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("click");
            jest.advanceTimersByTime(0);

            expect(view.actionRingOpen).toBe(false);
            expect(onWillOpen).toHaveBeenCalledTimes(1);
            expect(onClosed).toHaveBeenCalledTimes(1);
            expect(onToggleBubble).not.toHaveBeenCalled();
            expect(doc.listenerCount("pointerdown")).toBe(0);
            expect(doc.activeElement).toBe(root);
        });
    });

    it("keeps an existing Ring open when a repeated hold is cancelled by a second pointer", () => {
        withFixture(({ doc, root, view, onToggleBubble, onWillOpen, onClosed }) => {
            view.openActionRing();
            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            jest.advanceTimersByTime(520);

            expect(view.actionRingOpen).toBe(true);
            expect(doc.listenerCount("pointerdown")).toBe(2);

            root.dispatch("pointerdown", {
                button: 0,
                pointerId: 2,
                pointerType: "mouse",
                isPrimary: false,
                clientX: 1,
                clientY: 0,
            });
            root.dispatch("pointerup", {
                pointerId: 1,
                isPrimary: true,
                clientX: 0,
                clientY: 0,
            });
            root.dispatch("click");

            expect(view.actionRingOpen).toBe(true);
            expect(onWillOpen).toHaveBeenCalledTimes(1);
            expect(onClosed).not.toHaveBeenCalled();
            expect(onToggleBubble).not.toHaveBeenCalled();
            expect(doc.listenerCount("pointerdown")).toBe(1);
        });
    });
});

describe("Pet Action Ring localization and layout contracts", () => {
    it("localizes the accessible group and action labels", () => {
        expect(getPetActionRingLabels("en")).toEqual({
            ariaLabel: "Pagelet actions",
            capture: "Capture",
            review: "Review",
            discover: "Discover",
        });
        expect(getPetActionRingLabels("zh").ariaLabel).toBe("拾页操作");
    });

    it("keeps root ARIA wiring, four inward corners, mobile safe area, focus, and reduced motion", () => {
        const source = readFileSync("src/pagelet/pet/PetView.ts", "utf8");
        const css = readFileSync("src/custom.pcss", "utf8");

        expect(source).toContain('trigger.setAttribute("aria-controls", this._actionRingId)');
        expect(source).toContain('trigger.setAttribute("aria-expanded", "false")');
        expect(source).toContain('ring.setAttribute("role", "group")');
        for (const corner of ["bottom-right", "bottom-left", "top-right", "top-left"]) {
            expect(css).toContain(
                `.pa-pagelet-pet[data-corner=${corner}] .pa-pagelet-action-ring-item`,
            );
        }
        expect(css).toContain("body.is-mobile .pa-pagelet-pet--mobile-toolbar .pa-pagelet-action-ring");
        expect(css).toContain(".pa-pagelet-action-ring-safe-area-probe");
        expect(css).toContain("env(safe-area-inset-top,0px)");
        expect(css).toContain("env(safe-area-inset-right,0px)");
        expect(css).toContain("env(safe-area-inset-bottom,0px)");
        expect(css).toContain("env(safe-area-inset-left,0px)");
        expect(css).toContain("min-width: 44px;");
        expect(css).toContain("min-height: 44px;");
        expect(css).toContain(".pa-pagelet-action-ring-item:focus-visible");
        expect(css).toMatch(
            /body\.is-mobile \.pa-pagelet-pet--mobile-toolbar \.pa-pagelet-action-ring-item:nth-child\(2\) \{[\s\S]*?--pa-action-ring-y: 0px;/,
        );
        expect(css).toMatch(
            /body\.is-mobile \.pa-pagelet-pet--mobile-toolbar \.pa-pagelet-action-ring-item:nth-child\(3\) \{[\s\S]*?--pa-action-ring-y: 0px;/,
        );
        expect(css).toMatch(/prefers-reduced-motion:[\s\S]*?\.pa-pagelet-action-ring-item \{[\s\S]*?animation: none;/);
    });

    it.each([
        ["bottom-right", false, { left: 0, top: 0, width: 320, height: 568 }],
        ["bottom-left", false, { left: 0, top: 0, width: 320, height: 568 }],
        ["top-right", false, { left: 0, top: 0, width: 320, height: 568 }],
        ["top-left", false, { left: 0, top: 0, width: 320, height: 568 }],
        ["bottom-left", true, { left: 0, top: 0, width: 320, height: 240 }],
        ["top-left", true, { left: 0, top: 0, width: 176, height: 568 }],
        ["top-left", true, { left: 0, top: 0, width: 320, height: 160 }],
        ["bottom-right", false, { left: 0, top: 0, width: 176, height: 568 }],
        ["top-left", false, { left: 0, top: 0, width: 320, height: 120 }],
    ] as const)("keeps %s%s actions inside a constrained visual viewport", (
        corner,
        mobileToolbar,
        viewport,
    ) => {
        const anchor = mobileToolbar
            ? { left: 16, top: 36, width: 44, height: 44 }
            : corner.includes("right")
                ? { left: viewport.width - 64, top: corner.startsWith("bottom") ? viewport.height - 92 : 48, width: 56, height: 56 }
                : { left: 8, top: corner.startsWith("bottom") ? viewport.height - 92 : 48, width: 56, height: 56 };
        const items = [
            { width: 88, height: 44 },
            { width: 80, height: 44 },
            { width: 96, height: 44 },
        ];
        const positions = computeActionRingLayout({
            viewport,
            anchor,
            items,
            corner,
            mobileToolbar,
        });

        expectActionRingInsideViewport(positions, items, viewport);
    });

    it("lays out the phone actions in one row from beneath the Pet toward the right", () => {
        const viewport = { left: 0, top: 0, width: 390, height: 844 };
        const anchor = { left: 56, top: 59, width: 44, height: 44 };
        const items = [
            { width: 88, height: 44 },
            { width: 80, height: 44 },
            { width: 96, height: 44 },
        ];
        const positions = computeActionRingLayout({
            viewport,
            anchor,
            items,
            corner: "top-left",
            mobileToolbar: true,
            safeAreaInsets: { top: 47, bottom: 34 },
        });

        expect(positions).toEqual([
            { left: 56, top: 111 },
            { left: 152, top: 111 },
            { left: 240, top: 111 },
        ]);
    });

    it("keeps the phone row horizontal when the right safe area shifts it left", () => {
        const viewport = { left: 0, top: 0, width: 320, height: 568 };
        const items = [
            { width: 88, height: 44 },
            { width: 80, height: 44 },
            { width: 96, height: 44 },
        ];
        const positions = computeActionRingLayout({
            viewport,
            anchor: { left: 140, top: 36, width: 44, height: 44 },
            items,
            corner: "top-left",
            mobileToolbar: true,
            safeAreaInsets: { right: 10 },
        });

        expect(new Set(positions.map((position) => position.top))).toEqual(new Set([88]));
        expect(positions.map((position) => position.left)).toEqual([22, 118, 206]);
        expectActionRingInsideViewport(
            positions,
            items,
            { left: 0, top: 0, width: 310, height: 568 },
        );
    });

    it("falls back to a compact phone column only when full labels cannot fit in one row", () => {
        const viewport = { left: 0, top: 0, width: 240, height: 568 };
        const items = [
            { width: 88, height: 44 },
            { width: 80, height: 44 },
            { width: 96, height: 44 },
        ];
        const positions = computeActionRingLayout({
            viewport,
            anchor: { left: 16, top: 36, width: 44, height: 44 },
            items,
            corner: "top-left",
            mobileToolbar: true,
        });

        expect(positions).toEqual([
            { left: 16, top: 88 },
            { left: 16, top: 140 },
            { left: 16, top: 192 },
        ]);
        expectActionRingInsideViewport(positions, items, viewport);
    });

    it("preserves the desktop corner geometry while changing the phone layout", () => {
        const positions = computeActionRingLayout({
            viewport: { left: 0, top: 0, width: 1000, height: 800 },
            anchor: { left: 100, top: 100, width: 56, height: 56 },
            items: [
                { width: 44, height: 44 },
                { width: 44, height: 44 },
                { width: 44, height: 44 },
            ],
            corner: "top-left",
            mobileToolbar: false,
        });

        expect(positions).toEqual([
            { left: 166, top: 114 },
            { left: 174, top: 170 },
            { left: 124, top: 206 },
        ]);
    });

    it("recomputes layout for visual viewport activity and refreshes inactivity on Ring use", () => {
        const source = readFileSync("src/pagelet/pet/PetView.ts", "utf8");

        expect(source).toContain("computeActionRingLayout");
        expect(source).toContain("win.visualViewport?.addEventListener");
        expect(source).toContain('win.addEventListener("orientationchange", reposition)');
        expect(source).toContain("installActionRingActivityListeners");
        expect(source).toContain("button.offsetWidth > 0");
        expect(source).toContain("readActionRingSafeAreaInsets(doc)");
    });

    it("keeps actions outside visual viewport safe-area insets", () => {
        const viewport = { left: 0, top: 0, width: 390, height: 844 };
        const items = [
            { width: 88, height: 44 },
            { width: 80, height: 44 },
            { width: 96, height: 44 },
        ];
        const safeAreaInsets = { top: 47, right: 0, bottom: 34, left: 0 };
        const positions = computeActionRingLayout({
            viewport,
            anchor: { left: 16, top: 16, width: 44, height: 44 },
            items,
            corner: "top-left",
            mobileToolbar: true,
            safeAreaInsets,
        });

        positions.forEach((position, index) => {
            const item = items[index];
            if (!item) throw new Error("missing Action Ring item size");
            expect(position.left).toBeGreaterThanOrEqual(8 + safeAreaInsets.left);
            expect(position.top).toBeGreaterThanOrEqual(8 + safeAreaInsets.top);
            expect(position.left + item.width).toBeLessThanOrEqual(
                viewport.width - 8 - safeAreaInsets.right,
            );
            expect(position.top + item.height).toBeLessThanOrEqual(
                viewport.height - 8 - safeAreaInsets.bottom,
            );
        });
    });

    it("clamps desktop actions to the visible Markdown surface when a sidebar narrows it", () => {
        const visualViewport = { left: 0, top: 0, width: 1365, height: 768 };
        const markdownSurface = { left: 31, top: 32, width: 855, height: 704 };
        const viewport = intersectActionRingViewport(visualViewport, markdownSurface);
        const items = [
            { width: 56, height: 44 },
            { width: 56, height: 44 },
            { width: 72, height: 44 },
        ];
        const positions = computeActionRingLayout({
            viewport,
            anchor: { left: 824, top: 680, width: 56, height: 56 },
            items,
            corner: "bottom-right",
            mobileToolbar: false,
        });

        expect(viewport).toEqual(markdownSurface);
        expectActionRingInsideViewport(positions, items, viewport);
    });
});

function expectActionRingInsideViewport(
    positions: readonly ActionRingItemPosition[],
    items: readonly ActionRingItemSize[],
    viewport: ActionRingLayoutRect,
): void {
    positions.forEach((position, index) => {
        const item = items[index];
        if (!item) throw new Error("missing Action Ring item size");
        expect(position.left).toBeGreaterThanOrEqual(viewport.left + 8);
        expect(position.top).toBeGreaterThanOrEqual(viewport.top + 8);
        expect(position.left + item.width).toBeLessThanOrEqual(
            viewport.left + viewport.width - 8,
        );
        expect(position.top + item.height).toBeLessThanOrEqual(
            viewport.top + viewport.height - 8,
        );
    });
    for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
            const leftPosition = positions[leftIndex];
            const rightPosition = positions[rightIndex];
            const leftItem = items[leftIndex];
            const rightItem = items[rightIndex];
            if (!leftPosition || !rightPosition || !leftItem || !rightItem) {
                throw new Error("missing Action Ring geometry");
            }
            const separated = leftPosition.left + leftItem.width <= rightPosition.left
                || rightPosition.left + rightItem.width <= leftPosition.left
                || leftPosition.top + leftItem.height <= rightPosition.top
                || rightPosition.top + rightItem.height <= leftPosition.top;
            expect(separated).toBe(true);
        }
    }
}
