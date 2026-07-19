/* Copyright 2023 edonyzpc */

/**
 * Regression coverage for the Pagelet bubble reading layout.
 *
 * The project does not depend on jsdom, so this file uses the same
 * small fake-DOM approach as the other raw-DOM Pagelet view tests.
 */

import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian", () => ({
    Notice: jest.fn(),
    setIcon: jest.fn((element: { setAttribute(name: string, value: string): void }, icon: string) => {
        element.setAttribute("data-icon", icon);
    }),
}));

type Listener = (event: {
    stopPropagation(): void;
    preventDefault(): void;
    target?: unknown;
    touches?: Array<{ clientX: number; clientY: number }>;
    changedTouches?: Array<{ clientX: number; clientY: number }>;
}) => void | Promise<void>;

interface FakeRect {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

class FakeClassList {
    constructor(private readonly owner: FakeElement) {}

    add(...classes: string[]): void {
        const tokens = new Set(this.tokens());
        for (const cls of classes) tokens.add(cls);
        this.owner.className = [...tokens].join(" ");
    }

    remove(...classes: string[]): void {
        const remove = new Set(classes);
        this.owner.className = this.tokens().filter((cls) => !remove.has(cls)).join(" ");
    }

    contains(className: string): boolean {
        return this.tokens().includes(className);
    }

    private tokens(): string[] {
        return this.owner.className.split(/\s+/).filter(Boolean);
    }
}

class FakeElement {
    readonly tagName: string;
    className = "";
    readonly classList = new FakeClassList(this);
    readonly style: Record<string, string> = {};
    private ownText = "";
    private attrs = new Map<string, string>();
    private listeners = new Map<string, Listener[]>();
    private rect: FakeRect = {
        top: 400,
        left: 400,
        right: 780,
        bottom: 620,
        width: 380,
        height: 220,
    };
    children: FakeElement[] = [];
    parent: FakeElement | null = null;
    offsetParent: FakeElement | null = null;
    childOffsetParent: FakeElement | null = null;
    childRectOnAppend: Partial<FakeRect> | null = null;
    isConnected = false;
    scrollTop = 0;
    scrollLeft = 0;
    focusCalls = 0;
    lastFocusOptions: unknown = null;

    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
    }

    get textContent(): string {
        return this.ownText + this.children.map((child) => child.textContent).join("");
    }

    set textContent(value: string | null) {
        this.ownText = value ?? "";
        for (const child of this.children) child.parent = null;
        this.children = [];
    }

    get firstChild(): FakeElement | null {
        return this.children[0] ?? null;
    }

    get parentElement(): FakeElement | null {
        return this.parent;
    }

    get offsetWidth(): number {
        return 380;
    }

    get offsetHeight(): number {
        return 220;
    }

    appendChild<T extends FakeElement>(child: T): T {
        child.parent = this;
        child.offsetParent = this.childOffsetParent ?? this;
        if (this.childRectOnAppend) {
            child.setRect(this.childRectOnAppend);
        }
        child.setConnected(this.isConnected);
        this.children.push(child);
        return child;
    }

    removeChild<T extends FakeElement>(child: T): T {
        this.children = this.children.filter((candidate) => candidate !== child);
        child.parent = null;
        child.offsetParent = null;
        child.setConnected(false);
        return child;
    }

    remove(): void {
        this.parent?.removeChild(this);
    }

    contains(target: unknown): boolean {
        if (target === this) return true;
        return this.children.some((child) => child.contains(target));
    }

    setAttribute(name: string, value: string): void {
        if (name === "class") this.className = value;
        this.attrs.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attrs.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        if (name === "class") this.className = "";
        this.attrs.delete(name);
    }

    setCssStyles(styles: Record<string, string>): void {
        Object.assign(this.style, styles);
    }

    setRect(rect: Partial<FakeRect>): void {
        this.rect = { ...this.rect, ...rect };
    }

    getBoundingClientRect(): DOMRect {
        return {
            ...this.rect,
            x: this.rect.left,
            y: this.rect.top,
            toJSON: () => ({}),
        } as DOMRect;
    }

    addEventListener(type: string, listener: Listener): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: Listener): void {
        const listeners = this.listeners.get(type) ?? [];
        this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
    }

    async click(): Promise<void> {
        for (const listener of this.listeners.get("click") ?? []) {
            await listener({
                stopPropagation: (): void => undefined,
                preventDefault: (): void => undefined,
                target: this,
            });
        }
    }

    async dispatch(type: string, event: Parameters<Listener>[0]): Promise<void> {
        for (const listener of this.listeners.get(type) ?? []) {
            await listener(event);
        }
    }

    focus(options?: unknown): void {
        this.focusCalls += 1;
        this.lastFocusOptions = options ?? null;
    }

    querySelector(selector: string): FakeElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        const matches: FakeElement[] = [];
        const visit = (node: FakeElement): void => {
            if (selector === "*") {
                matches.push(node);
            } else if (selector.startsWith(".")) {
                if (node.classList.contains(selector.slice(1))) matches.push(node);
            } else if (node.tagName.toLowerCase() === selector.toLowerCase()) {
                matches.push(node);
            }
            for (const child of node.children) visit(child);
        };
        visit(this);
        return matches;
    }

    private setConnected(value: boolean): void {
        this.isConnected = value;
        for (const child of this.children) child.setConnected(value);
    }
}

class FakeDocument {
    readonly body = new FakeElement("body");
    readonly documentElement = { clientWidth: 1200, clientHeight: 900 };
    private listeners = new Map<string, Listener[]>();

    constructor() {
        this.body.isConnected = true;
    }

    createElement(tagName: string): FakeElement {
        return new FakeElement(tagName);
    }

    addEventListener(type: string, listener: Listener): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: Listener): void {
        const listeners = this.listeners.get(type) ?? [];
        this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
    }

    async dispatch(type: string, event: Parameters<Listener>[0]): Promise<void> {
        for (const listener of this.listeners.get(type) ?? []) {
            await listener(event);
        }
    }
}

const globalRecord = globalThis as unknown as Record<string, unknown>;
const originalDocument = globalRecord.document;
const originalWindow = globalRecord.window;

function getCssBlock(source: string, marker: string): string {
    const markerStart = source.indexOf(marker);
    if (markerStart < 0) throw new Error(`Missing CSS marker: ${marker}`);
    const blockStart = source.indexOf("{", markerStart);
    if (blockStart < 0) throw new Error(`Missing CSS block: ${marker}`);

    let depth = 0;
    for (let index = blockStart; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        if (source[index] === "}") {
            depth -= 1;
            if (depth === 0) return source.slice(markerStart, index + 1);
        }
    }
    throw new Error(`Unclosed CSS block: ${marker}`);
}

globalRecord.document = new FakeDocument();

import { BubbleView } from "../src/pagelet/bubble/BubbleView";

describe("Pagelet BubbleView", () => {
    beforeEach(() => {
        globalRecord.document = new FakeDocument();
        globalRecord.window = undefined;
    });

    afterAll(() => {
        globalRecord.document = originalDocument;
        globalRecord.window = originalWindow;
    });

    it("renders source links below finding text so long titles cannot squeeze the reading column", () => {
        const onSourceClick = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const anchor = new FakeElement("button");
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "writing-assist",
            findings: [{
                text: "After segment 1, add a rollback section with clear retrospective criteria.",
                sourceLink: "Weekly Product Review.md",
                sourceTitle: "Weekly Product Review",
            }],
            actions: [],
        }, anchor as unknown as HTMLElement);

        const item = container.querySelector(".pa-pagelet-bubble-items")?.querySelector("li");
        const body = item?.querySelector(".pa-pagelet-bubble-item-body");
        const text = body?.querySelector(".pa-pagelet-bubble-text");
        const source = body?.querySelector(".pa-pagelet-bubble-source-link");

        expect(body).not.toBeNull();
        expect(text?.textContent).toBe(
            "After segment 1, add a rollback section with clear retrospective criteria.",
        );
        expect(source?.textContent).toBe("Weekly Product Review");
        expect(source?.getAttribute("title")).toBe("Weekly Product Review");
        expect(item?.children.map((child) => child.className)).toEqual([
            "pa-pagelet-bubble-bullet",
            "pa-pagelet-bubble-item-body",
        ]);

        view.destroy();
    });

    it("renders icon and description quick actions as a rich vertical action group", () => {
        const onReview = jest.fn();
        const onDiscover = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const anchor = new FakeElement("button");
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "empty",
            findings: [{ text: "No new findings yet." }],
            actions: [{
                label: "Review current note",
                description: "Scan the active note now",
                icon: "search",
                primary: true,
                callback: onReview,
            }, {
                label: "Discover connections",
                description: "Find related notes",
                icon: "link",
                callback: onDiscover,
            }],
        }, anchor as unknown as HTMLElement);

        const bubble = container.querySelector(".pa-pagelet-bubble");
        const actions = bubble?.querySelector(".pa-pagelet-bubble-actions");
        const buttons = actions?.querySelectorAll(".pa-pagelet-bubble-btn") ?? [];
        const bubbleLabel = bubble?.querySelector(".pa-sr-only");

        expect(bubble?.getAttribute("data-content-type")).toBe("empty");
        expect(bubble?.getAttribute("aria-label")).toBeNull();
        expect(bubble?.getAttribute("aria-labelledby")).toBe(bubbleLabel?.getAttribute("id"));
        expect(actions?.classList.contains("pa-pagelet-bubble-actions--rich")).toBe(true);
        expect(buttons).toHaveLength(2);
        expect(buttons[0].getAttribute("type")).toBe("button");
        expect(buttons[0].getAttribute("data-icon")).toBeNull();
        expect(buttons[0].querySelector(".pa-pagelet-bubble-btn-icon")?.getAttribute("data-icon")).toBe("search");
        expect(buttons[0].querySelector(".pa-pagelet-bubble-btn-label")?.textContent).toBe("Review current note");
        expect(buttons[0].querySelector(".pa-pagelet-bubble-btn-description")?.textContent).toBe("Scan the active note now");
        expect(buttons[0].getAttribute("title")).toBe("Review current note: Scan the active note now");
        expect(buttons[0].getAttribute("aria-label")).toBeNull();

        view.destroy();
    });

    it("localizes the compact Discover-only context action", async () => {
        const onDiscover = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const anchor = new FakeElement("button");
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "zh",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "ready-empty",
            findings: [{ text: "暂时没有足够值得带回来的内容。" }],
            actions: [],
            contextAction: {
                label: "找到 2 篇相关笔记",
                action: "discover",
                callback: onDiscover,
            },
        }, anchor as unknown as HTMLElement);

        const zone = container.querySelector(".pa-pagelet-bubble-context-action");
        const button = zone?.querySelector(".pa-pagelet-bubble-context-action-btn");
        expect(zone?.querySelector(".pa-pagelet-bubble-context-action-label")?.textContent)
            .toBe("找到 2 篇相关笔记");
        expect(button?.textContent).toBe("发现");

        await button?.click();
        expect(onDiscover).toHaveBeenCalledTimes(1);
        view.destroy();
    });

    it("keeps the mobile context action touch-sized", () => {
        const css = readFileSync("src/custom.pcss", "utf8");
        const block = getCssBlock(
            css,
            "body.is-mobile .pa-pagelet-bubble-context-action-btn",
        );

        expect(block).toContain("min-width: 44px;");
        expect(block).toContain("min-height: 44px;");
    });

    it("renders a local clue as Discovery without Recall stack or why-now chrome", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const anchor = new FakeElement("button");
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "discovery",
            findings: [{ text: "Local related clue" }, {
                text: "Related by local note signals.",
                sourceLink: "notes/local.md",
                sourceTitle: "local",
            }],
            actions: [],
        }, anchor as unknown as HTMLElement);

        const bubble = container.querySelector(".pa-pagelet-bubble");
        expect(bubble?.getAttribute("data-content-type")).toBe("discovery");
        expect(bubble?.querySelectorAll(".pa-pagelet-bubble-text").map((item) => item.textContent))
            .toEqual(["Local related clue", "Related by local note signals."]);
        expect(bubble?.querySelector(".pa-pagelet-bubble-inline-hint")?.getAttribute("hidden"))
            .toBe("true");
        expect(bubble?.querySelector(".pa-pagelet-bubble-stack-nav")?.getAttribute("hidden"))
            .toBe("true");
        expect(bubble?.querySelectorAll(".pa-pagelet-bubble-stack-dot")).toHaveLength(0);

        view.destroy();
    });

    it("renders one active Bubble card at a time and routes actions to the active card", async () => {
        const first = jest.fn();
        const second = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const anchor = new FakeElement("button");
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "recall-delivery",
            findings: [],
            actions: [],
            cards: [{
                id: "card-1",
                findings: [{ text: "First recall" }],
                actions: [{ label: "Open first", primary: true, callback: first }],
            }, {
                id: "card-2",
                findings: [{ text: "Second recall" }],
                inlineHint: { text: "Second why now", icon: "info" },
                actions: [{ label: "Open second", primary: true, callback: second }],
            }],
        }, anchor as unknown as HTMLElement);

        const bubble = container.querySelector(".pa-pagelet-bubble");
        expect(bubble?.querySelector(".pa-pagelet-bubble-text")?.textContent).toBe("First recall");
        expect(bubble?.querySelectorAll(".pa-pagelet-bubble-stack-dot")).toHaveLength(2);
        expect(bubble?.querySelectorAll(".pa-pagelet-bubble-stack-btn")[0]?.textContent).toContain("Previous card");
        expect(bubble?.querySelectorAll(".pa-pagelet-bubble-stack-btn")[1]?.textContent).toContain("Next card");
        expect(bubble?.querySelectorAll(".pa-pagelet-bubble-stack-dot")[0]?.textContent).toBe("Show card 1 of 2");

        const next = bubble?.querySelectorAll(".pa-pagelet-bubble-stack-btn")[1];
        await next?.click();

        expect(bubble?.querySelector(".pa-pagelet-bubble-text")?.textContent).toBe("Second recall");
        expect(bubble?.querySelector(".pa-pagelet-bubble-inline-hint-text")?.textContent).toBe("Second why now");
        expect(bubble?.querySelectorAll(".pa-pagelet-bubble-stack-dot")[1]?.focusCalls).toBe(1);

        const active = bubble?.querySelector(".pa-pagelet-bubble-btn");
        await active?.click();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it("resets stacked cards to the first card after closing", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const anchor = new FakeElement("button");
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });
        const content = {
            type: "recall-delivery" as const,
            findings: [],
            actions: [],
            cards: [{
                id: "card-1",
                findings: [{ text: "First recall" }],
                actions: [],
            }, {
                id: "card-2",
                findings: [{ text: "Second recall" }],
                actions: [],
            }],
        };

        view.mount(container as unknown as HTMLElement);
        view.show(content, anchor as unknown as HTMLElement);
        const bubble = container.querySelector(".pa-pagelet-bubble");
        await bubble?.querySelectorAll(".pa-pagelet-bubble-stack-btn")[1]?.click();
        expect(bubble?.querySelector(".pa-pagelet-bubble-text")?.textContent).toBe("Second recall");

        view.close({ restoreFocus: false });
        view.show(content, anchor as unknown as HTMLElement);

        expect(bubble?.querySelector(".pa-pagelet-bubble-text")?.textContent).toBe("First recall");

        view.destroy();
    });

    it("keeps the close icon accessible without creating an Obsidian aria-label tooltip", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const anchor = new FakeElement("button");
        anchor.isConnected = true;
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "empty",
            findings: [{ text: "No new findings yet." }],
            actions: [],
        }, anchor as unknown as HTMLElement);

        const close = container.querySelector(".pa-pagelet-bubble-close");

        expect(close?.getAttribute("title")).toBe("Close");
        expect(close?.getAttribute("aria-label")).toBeNull();
        expect(close?.querySelector(".pa-sr-only")?.textContent).toBe("Close");

        view.destroy();
    });

    it("activates rich actions from touchend without double-firing the synthetic click", async () => {
        const onReview = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const anchor = new FakeElement("button");
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "empty",
            findings: [{ text: "No new findings yet." }],
            actions: [{
                label: "Review current note",
                description: "Scan the active note now",
                icon: "search",
                primary: true,
                callback: onReview,
            }],
        }, anchor as unknown as HTMLElement);

        const primary = container.querySelector(".pa-pagelet-bubble-btn");
        const stopPropagation = jest.fn();
        const preventDefault = jest.fn();

        await primary?.dispatch("touchstart", {
            stopPropagation: (): void => undefined,
            preventDefault: (): void => undefined,
            target: primary,
            touches: [{ clientX: 24, clientY: 32 }],
            changedTouches: [],
        });
        await primary?.dispatch("touchend", {
            stopPropagation,
            preventDefault,
            target: primary,
            touches: [],
            changedTouches: [{ clientX: 25, clientY: 34 }],
        });
        await primary?.click();

        expect(onReview).toHaveBeenCalledTimes(1);
        expect(stopPropagation).toHaveBeenCalledTimes(1);
        expect(preventDefault).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it("keeps portrait bubbles near-full-width and bounds shallow phone landscapes", () => {
        const css = readFileSync("src/custom.pcss", "utf8");
        const mobileBlock = getCssBlock(css, ".pa-pagelet-bubble.pa-pagelet-bubble--mobile");
        const landscapeBlock = getCssBlock(
            css,
            "@media (orientation: landscape) and (max-height: 500px)",
        );

        expect(mobileBlock).toContain("left: 8px;");
        expect(mobileBlock).toContain("right: 8px;");
        expect(mobileBlock).toContain("width: auto;");
        expect(landscapeBlock).toContain(
            "body.is-mobile .pa-pagelet-bubble.pa-pagelet-bubble--mobile",
        );
        expect(landscapeBlock).toContain("env(safe-area-inset-left, 0px)");
        expect(landscapeBlock).toContain("env(safe-area-inset-right, 0px)");
        expect(landscapeBlock).toContain("width: min(");
        expect(landscapeBlock).toContain("480px");
        expect(landscapeBlock).toContain("margin-inline: auto;");
        expect(landscapeBlock).not.toContain("transform:");
        expect(landscapeBlock).not.toContain("position:");
        expect(landscapeBlock).not.toContain("z-index:");
    });

    it("keeps the first desktop placement inside the visible viewport edge", () => {
        const doc = globalRecord.document as FakeDocument;
        doc.documentElement.clientWidth = 426;
        doc.documentElement.clientHeight = 900;

        const container = new FakeElement("div");
        container.isConnected = true;
        container.setRect({
            top: 0,
            left: 0,
            right: 520,
            bottom: 900,
            width: 520,
            height: 900,
        });
        const anchor = new FakeElement("button");
        anchor.setRect({
            top: 760,
            left: 390,
            right: 446,
            bottom: 816,
            width: 56,
            height: 56,
        });
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "writing-assist",
            findings: [{ text: "No new findings yet." }],
            actions: [],
        }, anchor as unknown as HTMLElement);

        const bubble = container.querySelector(".pa-pagelet-bubble");

        expect(bubble?.style.maxWidth).toBe("394px");
        expect(bubble?.style.maxHeight).toBe("868px");
        expect(bubble?.style.overflowY).toBe("auto");
        expect(bubble?.style.left).toBe("30px");
        expect(bubble?.getAttribute("data-placement")).toBe("above");

        view.destroy();
    });

    it("keeps tall desktop quick actions scrollable inside short windows", () => {
        const doc = globalRecord.document as FakeDocument;
        doc.documentElement.clientWidth = 426;
        doc.documentElement.clientHeight = 180;

        const container = new FakeElement("div");
        container.isConnected = true;
        container.setRect({
            top: 0,
            left: 0,
            right: 426,
            bottom: 180,
            width: 426,
            height: 180,
        });
        const anchor = new FakeElement("button");
        anchor.setRect({
            top: 120,
            left: 360,
            right: 416,
            bottom: 176,
            width: 56,
            height: 56,
        });
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "empty",
            findings: [{ text: "No new findings yet." }],
            actions: [{
                label: "Review current note",
                description: "Scan the active note now",
                icon: "search",
                primary: true,
                callback: () => undefined,
            }, {
                label: "Discover connections",
                description: "Find related notes",
                icon: "link",
                callback: () => undefined,
            }, {
                label: "Open detail",
                description: "Review prepared context",
                icon: "calendar",
                callback: () => undefined,
            }],
        }, anchor as unknown as HTMLElement);

        const bubble = container.querySelector(".pa-pagelet-bubble");

        expect(bubble?.style.maxHeight).toBe("160px");
        expect(bubble?.style.overflowY).toBe("auto");

        view.destroy();
    });

    it("moves focus into the bubble and restores focus to the anchor on close", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const anchor = new FakeElement("button");
        anchor.isConnected = true;
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "empty",
            findings: [{ text: "No new findings yet." }],
            actions: [{
                label: "Review current note",
                description: "Scan the active note now",
                icon: "search",
                primary: true,
                callback: () => undefined,
            }],
        }, anchor as unknown as HTMLElement);

        const primary = container.querySelector(".pa-pagelet-bubble-btn");

        expect(primary?.focusCalls).toBe(1);
        expect(primary?.lastFocusOptions).toEqual({ preventScroll: true });

        view.close();

        expect(anchor.focusCalls).toBe(1);
        expect(anchor.lastFocusOptions).toEqual({ preventScroll: true });

        view.destroy();
    });

    it("does not restore focus to the anchor when dismissed by outside click", async () => {
        jest.useFakeTimers();
        try {
            const doc = globalRecord.document as FakeDocument;
            const onDismiss = jest.fn();
            const container = new FakeElement("div");
            container.isConnected = true;
            const anchor = new FakeElement("button");
            anchor.isConnected = true;
            const outside = new FakeElement("div");
            const view = new BubbleView({
                callbacks: {
                    onDismiss,
                    onExpandPanel: () => undefined,
                    onSourceClick: () => undefined,
                },
                getLocale: () => "en",
            });

            view.mount(container as unknown as HTMLElement);
            view.show({
                type: "empty",
                findings: [{ text: "No new findings yet." }],
                actions: [{
                    label: "Review current note",
                    description: "Scan the active note now",
                    icon: "search",
                    primary: true,
                    callback: () => undefined,
                }],
            }, anchor as unknown as HTMLElement);
            jest.runOnlyPendingTimers();

            await doc.dispatch("click", {
                stopPropagation: (): void => undefined,
                preventDefault: (): void => undefined,
                target: outside,
            });

            expect(view.bubbleState).toBe("hidden");
            expect(anchor.focusCalls).toBe(0);
            expect(onDismiss).toHaveBeenCalledTimes(1);

            view.destroy();
        } finally {
            jest.useRealTimers();
        }
    });

    it("uses the bubble offset parent when the workspace container starts before the viewport", () => {
        const doc = globalRecord.document as FakeDocument;
        doc.documentElement.clientWidth = 1264;
        doc.documentElement.clientHeight = 882;

        const viewportParent = new FakeElement("div");
        viewportParent.setRect({
            top: 0,
            left: 0,
            right: 1264,
            bottom: 882,
            width: 1264,
            height: 882,
        });
        const container = new FakeElement("div");
        container.isConnected = true;
        container.childOffsetParent = viewportParent;
        container.setRect({
            top: 0,
            left: -38,
            right: 1302,
            bottom: 882,
            width: 1340,
            height: 882,
        });
        const anchor = new FakeElement("button");
        anchor.setRect({
            top: 790,
            left: 1188,
            right: 1244,
            bottom: 846,
            width: 56,
            height: 56,
        });
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "writing-assist",
            findings: [{ text: "No new findings yet." }],
            actions: [],
        }, anchor as unknown as HTMLElement);

        const bubble = container.querySelector(".pa-pagelet-bubble");

        expect(bubble?.style.maxWidth).toBe("1232px");
        expect(bubble?.style.left).toBe("868px");

        view.destroy();
    });

    it("uses layout width instead of transformed first-frame width for edge clamping", () => {
        const doc = globalRecord.document as FakeDocument;
        doc.documentElement.clientWidth = 1264;
        doc.documentElement.clientHeight = 882;

        const container = new FakeElement("div");
        container.isConnected = true;
        container.childRectOnAppend = {
            left: 0,
            right: 342,
            width: 342,
            height: 126,
        };
        container.setRect({
            top: 0,
            left: 0,
            right: 1264,
            bottom: 882,
            width: 1264,
            height: 882,
        });
        const anchor = new FakeElement("button");
        anchor.setRect({
            top: 790,
            left: 1188,
            right: 1244,
            bottom: 846,
            width: 56,
            height: 56,
        });
        const view = new BubbleView({
            callbacks: {
                onDismiss: () => undefined,
                onExpandPanel: () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => "en",
        });

        view.mount(container as unknown as HTMLElement);
        view.show({
            type: "writing-assist",
            findings: [{ text: "No new findings yet." }],
            actions: [],
        }, anchor as unknown as HTMLElement);

        const bubble = container.querySelector(".pa-pagelet-bubble");

        expect(bubble?.style.left).toBe("868px");

        view.destroy();
    });
});
