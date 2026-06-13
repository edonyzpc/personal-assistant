/* Copyright 2023 edonyzpc */

/**
 * Regression coverage for Pagelet's raw-DOM panel/tab views.
 *
 * The project does not depend on jsdom, so this file installs the tiny DOM
 * subset those bounded view classes need before importing them.
 */

import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian", () => ({
    Notice: jest.fn(),
    addIcon: jest.fn(),
    Component: class {
        load(): void {}
        unload(): void {}
    },
    ItemView: class {
        leaf: unknown;
        contentEl: unknown;

        constructor(leaf: unknown) {
            this.leaf = leaf;
            this.contentEl = (globalThis as unknown as { document: Document }).document.createElement("div");
        }
    },
}));

type Listener = (event: { stopPropagation(): void; preventDefault(): void; target?: unknown }) => void | Promise<void>;

class FakeElement {
    readonly tagName: string;
    className = "";
    private ownText = "";
    private attrs = new Map<string, string>();
    private listeners = new Map<string, Listener[]>();
    children: FakeElement[] = [];
    parent: FakeElement | null = null;
    isConnected = false;
    disabled = false;

    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
    }

    get textContent(): string {
        return this.ownText + this.children.map((child) => child.textContent).join("");
    }

    set textContent(value: string | null) {
        this.ownText = value ?? "";
        this.children = [];
    }

    set innerHTML(_value: string) {
        this.ownText = "";
        for (const child of this.children) {
            child.parent = null;
            child.isConnected = false;
        }
        this.children = [];
    }

    get offsetWidth(): number {
        return 0;
    }

    get classList(): { contains: (name: string) => boolean } {
        return {
            contains: (name: string): boolean => this.className.split(/\s+/).includes(name),
        };
    }

    appendChild<T extends FakeElement>(child: T): T {
        child.parent = this;
        child.setConnected(this.isConnected);
        this.children.push(child);
        return child;
    }

    remove(): void {
        if (this.parent) {
            this.parent.children = this.parent.children.filter((child) => child !== this);
        }
        this.parent = null;
        this.setConnected(false);
    }

    setAttribute(name: string, value: string): void {
        this.attrs.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this.attrs.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attrs.delete(name);
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

    querySelector(selector: string): FakeElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        const matches: FakeElement[] = [];
        const visit = (node: FakeElement): void => {
            if (selector === "*") {
                matches.push(node);
            } else if (selector.startsWith(".")) {
                const className = selector.slice(1);
                if (node.classList.contains(className)) matches.push(node);
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
        for (const child of this.children) {
            child.setConnected(value);
        }
    }
}

class FakeDocument {
    readonly head = new FakeElement("head");
    readonly body = new FakeElement("body");

    constructor() {
        this.head.isConnected = true;
        this.body.isConnected = true;
    }

    createElement(tagName: string): FakeElement {
        return new FakeElement(tagName);
    }

    createElementNS(_namespace: string, tagName: string): FakeElement {
        return new FakeElement(tagName);
    }

    getElementById(id: string): FakeElement | null {
        const all = [...this.head.querySelectorAll("*"), ...this.body.querySelectorAll("*")];
        return all.find((node) => node.getAttribute("id") === id) ?? null;
    }

    addEventListener(): void {}
    removeEventListener(): void {}
}

const globalRecord = globalThis as unknown as Record<string, unknown>;
const originalDocument = globalRecord.document;
const originalRequestAnimationFrame = globalRecord.requestAnimationFrame;

globalRecord.HTMLElement = FakeElement;
globalRecord.document = new FakeDocument();
globalRecord.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0);
    return 0;
};

import { PanelView } from "../src/pagelet/panel/PanelView";
import { TabView } from "../src/pagelet/tab/TabView";
import {
    PAGELET_DETAIL_ICON,
    PAGELET_DETAIL_VIEW_TYPE,
    PageletDetailView,
} from "../src/pagelet/tab/PageletDetailView";

describe("Pagelet panel and tab view regressions", () => {
    beforeEach(() => {
        globalRecord.document = new FakeDocument();
    });

    afterAll(() => {
        globalRecord.document = originalDocument;
        globalRecord.requestAnimationFrame = originalRequestAnimationFrame;
    });

    it("renders an explicit empty state when the tab opens without findings", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");

        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", []);

        expect(container.textContent).toContain("No findings yet");
        expect(container.textContent).toContain("Detail results are temporary");
    });

    it("renders only leaf content without custom tab chrome", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");

        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", []);

        expect(container.querySelector(".pa-pagelet-tab")).not.toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-header")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-pill")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-close")).toBeNull();
    });

    it("exposes Pagelet detail as a native Obsidian item view", async () => {
        const view = new PageletDetailView({} as never, () => "en");

        expect(view.getViewType()).toBe(PAGELET_DETAIL_VIEW_TYPE);
        expect(view.getIcon()).toBe(PAGELET_DETAIL_ICON);

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            content: [],
            locale: "en",
        });

        expect(view.getDisplayText()).toBe("Pagelet — Detail View");
        const contentEl = view.contentEl as unknown as FakeElement;
        expect(contentEl.textContent).toContain("No findings yet");
        expect(contentEl.querySelector(".pa-pagelet-tab-header")).toBeNull();
    });

    it("shows visible review progress and restores the panel after current-note review", async () => {
        let resolveReview = (): void => undefined;
        const reviewPromise = new Promise<void>((resolve) => {
            resolveReview = resolve;
        });
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onRunReview: async () => reviewPromise,
            },
            locale: "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("review", []);
        const runButton = container.querySelector(".pa-pagelet-panel-save-btn");

        const clickPromise = runButton?.click();

        expect(container.textContent).toContain("Reviewing current note...");
        expect(runButton?.disabled).toBe(true);
        expect(runButton?.getAttribute("aria-busy")).toBe("true");

        resolveReview();
        await clickPromise;

        expect(runButton?.disabled).toBe(false);
        expect(runButton?.getAttribute("aria-busy")).toBeNull();
        expect(runButton?.textContent).toContain("Review current note");
        expect(container.textContent).not.toContain("Reviewing current note...");
    });
});
