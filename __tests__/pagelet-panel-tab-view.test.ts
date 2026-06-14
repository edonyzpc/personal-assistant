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
    checked = false;
    value = "";

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

    get parentElement(): FakeElement | null {
        return this.parent;
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

    removeChild<T extends FakeElement>(child: T): T {
        this.children = this.children.filter((candidate) => candidate !== child);
        child.parent = null;
        child.setConnected(false);
        return child;
    }

    setAttribute(name: string, value: string): void {
        if (name === "class") {
            this.className = value;
        }
        if (name === "type" && value === "checkbox") {
            this.checked = false;
        }
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
        if (this.tagName === "INPUT" && this.getAttribute("type") === "checkbox" && !this.disabled) {
            this.checked = !this.checked;
        }
        for (const listener of this.listeners.get("click") ?? []) {
            await listener({
                stopPropagation: (): void => undefined,
                preventDefault: (): void => undefined,
                target: this,
            });
        }
        for (const listener of this.listeners.get("change") ?? []) {
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

    it("wires review scope controls to Review selected and candidate callbacks", async () => {
        const runSelected = jest.fn(async () => undefined);
        const rangeChange = jest.fn();
        const toggleCandidate = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onRunReview: async () => undefined,
                onRunSelectedReview: runSelected,
                onScopeRangeChange: rangeChange,
                onScopeCandidateToggle: toggleCandidate,
            },
            locale: "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("review", [], {
            scope: {
                range: "last3",
                candidates: [
                    {
                        path: "active.md",
                        title: "active",
                        reason: "active",
                        included: true,
                    },
                    {
                        path: "recent.md",
                        title: "recent",
                        reason: "modified",
                        included: true,
                    },
                ],
                includedCount: 2,
                skippedCount: 0,
                estimatedInputTokens: 120,
            },
        });

        expect(container.textContent).toContain("Review selected (2)");
        await container.querySelector(".pa-pagelet-panel-save-btn")?.click();
        expect(runSelected).toHaveBeenCalledTimes(1);

        await container.querySelectorAll(".pa-pagelet-panel-scope-range-btn")[1]?.click();
        expect(rangeChange).toHaveBeenCalledWith("yesterday");

        await container.querySelector(".pa-pagelet-panel-scope-checkbox")?.click();
        expect(toggleCandidate).toHaveBeenCalledWith("active.md", false);
    });

    it("renders suggestion cards with draft save workflow", async () => {
        const saved: unknown[][] = [];
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async (findings) => { saved.push(findings); },
                onSourceClick: () => undefined,
            },
            locale: "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("current", [{
            title: "Evidence",
            description: "Add the citation.",
            sourceFile: "source.md",
            sourceTitle: "source",
            sourceId: "seg-1",
            suggestion: {
                source_id: "seg-1",
                kind: "evidence",
                rationale: "The claim needs a citation.",
                proposed_action: "Add a citation after the claim.",
                related_notes: ["Research notes"],
            },
        }]);

        expect(container.querySelector(".pa-pagelet-suggestion-card")).not.toBeNull();
        await container.querySelector(".pa-pagelet-suggestion-card__btn--accept")?.click();
        expect(container.textContent).toContain("Draft");
        expect(container.textContent).toContain("Remove");

        await container.querySelector(".pa-pagelet-panel-save-btn")?.click();
        expect(saved).toHaveLength(1);
        expect(saved[0][0]).toMatchObject({
            description: "Add a citation after the claim.",
            sourceFile: "source.md",
            suggestion: {
                source_id: "seg-1",
                kind: "evidence",
                rationale: "The claim needs a citation.",
                proposed_action: "Add a citation after the claim.",
                related_notes: ["Research notes"],
            },
        });
    });

    it("dismisses only the selected suggestion when source ids are shared", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
            },
            locale: "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("current", [
            {
                title: "Expand",
                description: "First action.",
                sourceFile: "source.md",
                sourceTitle: "source",
                sourceId: "seg-1",
                suggestion: {
                    source_id: "seg-1",
                    kind: "expand",
                    rationale: "First reason.",
                    proposed_action: "First action.",
                    related_notes: [],
                },
            },
            {
                title: "Clarify",
                description: "Second action.",
                sourceFile: "source.md",
                sourceTitle: "source",
                sourceId: "seg-1",
                suggestion: {
                    source_id: "seg-1",
                    kind: "clarify",
                    rationale: "Second reason.",
                    proposed_action: "Second action.",
                    related_notes: [],
                },
            },
        ]);

        expect(container.querySelectorAll(".pa-pagelet-suggestion-card")).toHaveLength(2);
        await container.querySelector(".pa-pagelet-suggestion-card__btn--dismiss")?.click();

        expect(container.querySelectorAll(".pa-pagelet-suggestion-card")).toHaveLength(1);
        expect(container.textContent).toContain("Second action.");
        expect(container.textContent).not.toContain("First action.");
    });
});
