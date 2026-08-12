import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { setPlatformMobile, resetPlatform } from "./helpers/platform-mock";

let mockWindowInnerHeight = 900;

jest.mock("../src/locales/plugin", () => ({
    getPluginUiLanguage: () => "en",
    makePluginTranslator: () => (key: string) => key,
}));
jest.mock("../src/platform-dom", () => ({
    getOptionalPlatformWindow: () => ({
        get innerHeight() { return mockWindowInnerHeight; },
        visualViewport: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        Capacitor: undefined,
    }),
    getOptionalPlatformDocument: () => ({
        documentElement: { clientHeight: mockWindowInnerHeight },
        body: { clientHeight: mockWindowInnerHeight },
    }),
    getPlatformDocument: () => ({
        documentElement: { clientHeight: mockWindowInnerHeight },
        body: { clientHeight: mockWindowInnerHeight, classList: { add: jest.fn(), remove: jest.fn(), contains: () => false } },
    }),
    requestPlatformAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    cancelPlatformAnimationFrame: (id: number) => clearTimeout(id),
    setPlatformTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearPlatformTimeout: (id: number) => clearTimeout(id),
}));

import { MobileInputAdapter } from "../src/chat/MobileInputAdapter";

function createMockElement(rect: Partial<DOMRect> = {}): HTMLElement {
    const style = new Map<string, string>();
    const classes = new Set<string>();
    return {
        getBoundingClientRect: () => ({
            top: 0, left: 0, right: 430, bottom: 900, width: 430, height: 900,
            x: 0, y: 0, toJSON: () => ({}),
            ...rect,
        }),
        setCssProps: (props: Record<string, string>) => {
            for (const [name, value] of Object.entries(props)) {
                if (value === "") style.delete(name);
                else style.set(name, value);
            }
        },
        style: {
            setProperty: (name: string, value: string) => style.set(name, value),
            removeProperty: (name: string) => style.delete(name),
            getPropertyValue: (name: string) => style.get(name) ?? "",
        },
        classList: {
            add: (...cls: string[]) => cls.forEach(c => classes.add(c)),
            remove: (...cls: string[]) => cls.forEach(c => classes.delete(c)),
            contains: (cls: string) => classes.has(cls),
        },
        querySelector: () => null,
        closest: () => null,
        ownerDocument: { body: { classList: { add: jest.fn(), remove: jest.fn(), contains: () => false } } },
    } as unknown as HTMLElement;
}

function createMockViewport(offsetTop: number, height: number): VisualViewport {
    return {
        offsetTop,
        height,
        width: 430,
        scale: 1,
        pageLeft: 0,
        pageTop: 0,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(() => true),
        onresize: null,
        onscroll: null,
    } as unknown as VisualViewport;
}

describe("MobileInputAdapter", () => {
    let adapter: MobileInputAdapter;
    let containerEl: HTMLElement;

    beforeEach(() => {
        setPlatformMobile();
        mockWindowInnerHeight = 900;
        containerEl = createMockElement();
        adapter = new MobileInputAdapter(containerEl, jest.fn());
    });

    afterEach(() => {
        resetPlatform();
    });

    describe("calculateVisualViewportKeyboardOverlap", () => {
        it("returns 0 when viewport is null", () => {
            const viewRect = { bottom: 900, height: 900 } as DOMRect;
            expect(adapter.calculateVisualViewportKeyboardOverlap(viewRect, null)).toBe(0);
        });

        it("returns 0 when viewport covers entire view (no keyboard)", () => {
            const viewRect = { bottom: 900, height: 900 } as DOMRect;
            const viewport = createMockViewport(0, 900);
            expect(adapter.calculateVisualViewportKeyboardOverlap(viewRect, viewport)).toBe(0);
        });

        it("calculates overlap when keyboard is visible", () => {
            const viewRect = { bottom: 900, height: 900 } as DOMRect;
            const viewport = createMockViewport(0, 600);
            expect(adapter.calculateVisualViewportKeyboardOverlap(viewRect, viewport)).toBe(300);
        });

        it("returns 0 when overlap is <= 1px (rounding tolerance)", () => {
            const viewRect = { bottom: 900, height: 900 } as DOMRect;
            const viewport = createMockViewport(0, 899.5);
            expect(adapter.calculateVisualViewportKeyboardOverlap(viewRect, viewport)).toBe(0);
        });

        it("caps overlap at viewRect.height", () => {
            const viewRect = { bottom: 200, height: 100 } as DOMRect;
            const viewport = createMockViewport(0, 50);
            expect(adapter.calculateVisualViewportKeyboardOverlap(viewRect, viewport)).toBe(100);
        });

        it("handles viewport with offsetTop > 0", () => {
            const viewRect = { bottom: 900, height: 800 } as DOMRect;
            const viewport = createMockViewport(50, 550);
            expect(adapter.calculateVisualViewportKeyboardOverlap(viewRect, viewport)).toBe(300);
        });

        it("returns 0 when viewportBottom is not finite", () => {
            const viewRect = { bottom: 900, height: 900 } as DOMRect;
            const viewport = createMockViewport(NaN, 600);
            expect(adapter.calculateVisualViewportKeyboardOverlap(viewRect, viewport)).toBe(0);
        });
    });

    describe("isVisualViewportKeyboardLikelyVisible", () => {
        it("returns false when viewport is null", () => {
            expect(adapter.isVisualViewportKeyboardLikelyVisible(null)).toBe(false);
        });

        it("returns false when viewport height matches layout height (no keyboard)", () => {
            const viewport = createMockViewport(0, 900);
            expect(adapter.isVisualViewportKeyboardLikelyVisible(viewport)).toBe(false);
        });

        it("returns true when viewport height is significantly less than layout height", () => {
            const viewport = createMockViewport(0, 600);
            expect(adapter.isVisualViewportKeyboardLikelyVisible(viewport)).toBe(true);
        });

        it("returns false when difference is <= 1px (tolerance)", () => {
            const viewport = createMockViewport(0, 899);
            expect(adapter.isVisualViewportKeyboardLikelyVisible(viewport)).toBe(false);
        });

        it("returns true when viewport is offset + shorter (iOS keyboard push)", () => {
            const viewport = createMockViewport(100, 500);
            expect(adapter.isVisualViewportKeyboardLikelyVisible(viewport)).toBe(true);
        });
    });

    describe("calculateKeyboardHeightOverlap", () => {
        beforeEach(() => {
            adapter.refreshKeyboardLayoutBaselineHeight();
        });

        it("returns 0 when keyboardHeight <= 0", () => {
            const viewRect = { bottom: 900, height: 900 } as DOMRect;
            expect(adapter.calculateKeyboardHeightOverlap(viewRect, 0)).toBe(0);
            expect(adapter.calculateKeyboardHeightOverlap(viewRect, -100)).toBe(0);
        });

        it("calculates overlap based on keyboard top position", () => {
            const viewRect = { bottom: 900, height: 900 } as DOMRect;
            const overlap = adapter.calculateKeyboardHeightOverlap(viewRect, 300);
            expect(overlap).toBe(300);
        });

        it("caps overlap at keyboard height", () => {
            const viewRect = { bottom: 500, height: 200 } as DOMRect;
            const overlap = adapter.calculateKeyboardHeightOverlap(viewRect, 300);
            expect(overlap).toBeLessThanOrEqual(300);
        });

        it("returns 0 when view is above keyboard", () => {
            const viewRect = { bottom: 100, height: 100 } as DOMRect;
            const overlap = adapter.calculateKeyboardHeightOverlap(viewRect, 300);
            expect(overlap).toBe(0);
        });

        it("detects layout shrink scenario (baseline > current)", () => {
            adapter.refreshKeyboardLayoutBaselineHeight();
            mockWindowInnerHeight = 600;
            const viewRect = { bottom: 700, height: 700 } as DOMRect;
            const overlap = adapter.calculateKeyboardHeightOverlap(viewRect, 300);
            expect(overlap).toBe(100);
        });
    });

    describe("measureComposerHeight", () => {
        it("returns height from getBoundingClientRect", () => {
            const inputEl = createMockElement({ height: 48 });
            expect(adapter.measureComposerHeight(inputEl)).toBe(48);
        });

        it("returns 0 for zero-height element", () => {
            const inputEl = createMockElement({ height: 0 });
            expect(adapter.measureComposerHeight(inputEl)).toBe(0);
        });

        it("rounds up fractional heights", () => {
            const inputEl = createMockElement({ height: 47.3 });
            expect(adapter.measureComposerHeight(inputEl)).toBe(48);
        });
    });

    describe("refreshKeyboardLayoutBaselineHeight", () => {
        it("captures window.innerHeight as baseline", () => {
            mockWindowInnerHeight = 812;
            adapter.refreshKeyboardLayoutBaselineHeight();
            const viewRect = { bottom: 812, height: 812 } as DOMRect;
            expect(adapter.calculateKeyboardHeightOverlap(viewRect, 300)).toBe(300);
        });

        it("updates baseline when called again", () => {
            mockWindowInnerHeight = 900;
            adapter.refreshKeyboardLayoutBaselineHeight();
            mockWindowInnerHeight = 600;
            adapter.refreshKeyboardLayoutBaselineHeight();
            const viewRect = { bottom: 600, height: 600 } as DOMRect;
            expect(adapter.calculateKeyboardHeightOverlap(viewRect, 300)).toBe(300);
        });
    });
});
