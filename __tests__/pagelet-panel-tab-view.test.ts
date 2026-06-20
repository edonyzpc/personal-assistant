/* Copyright 2023 edonyzpc */

/**
 * Regression coverage for Pagelet's raw-DOM panel/tab views.
 *
 * The project does not depend on jsdom, so this file installs the tiny DOM
 * subset those bounded view classes need before importing them.
 */

import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockMarkdownRender = jest.fn((
    _app: unknown,
    markdown: string,
    target: HTMLElement,
    _sourcePath: string,
    _component: unknown,
) => {
    const rendered = (globalThis as unknown as { document: Document }).document.createElement("div");
    rendered.className = "mermaid";
    rendered.textContent = markdown;
    target.appendChild(rendered);
    return Promise.resolve();
});

jest.mock("obsidian", () => ({
    Notice: jest.fn(),
    addIcon: jest.fn(),
    Component: class {
        load(): void {}
        unload(): void {}
    },
    MarkdownRenderer: {
        render: mockMarkdownRender,
    },
    ItemView: class {
        app: unknown;
        leaf: unknown;
        contentEl: unknown;

        constructor(leaf: unknown) {
            this.app = {};
            this.leaf = leaf;
            this.contentEl = (globalThis as unknown as { document: Document }).document.createElement("div");
        }
    },
}));

type Listener = (event: {
    stopPropagation(): void;
    preventDefault(): void;
    target?: unknown;
    [key: string]: unknown;
}) => void | Promise<void>;

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

    get firstChild(): FakeElement | null {
        return this.children[0] ?? null;
    }

    get parentElement(): FakeElement | null {
        return this.parent;
    }

    appendChild<T extends FakeElement>(child: T): T {
        if (child.parent) {
            child.parent.children = child.parent.children.filter((candidate) => candidate !== child);
        }
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

    async dispatch(type: string, event: Record<string, unknown> = {}): Promise<void> {
        for (const listener of this.listeners.get(type) ?? []) {
            await listener({
                stopPropagation: (): void => undefined,
                preventDefault: (): void => undefined,
                target: this,
                ...event,
            });
        }
    }

    getBoundingClientRect(): DOMRect {
        return {
            top: 0,
            left: 0,
            right: 360,
            bottom: 220,
            width: 360,
            height: 220,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        } as DOMRect;
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
        mockMarkdownRender.mockClear();
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

        const root = container.querySelector(".pa-pagelet-tab");
        const label = root?.querySelector(".pa-sr-only");

        expect(root?.getAttribute("aria-label")).toBeNull();
        expect(root?.getAttribute("aria-labelledby")).toBe(label?.getAttribute("id"));
        expect(label?.textContent).toBe("Pagelet — Detail View");
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

    it("renders discovery payloads in the native detail tab", async () => {
        const view = new PageletDetailView({} as never, () => "en");

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "discover",
            content: [{
                title: "Diary thread",
                description: "Shared diary thread",
                insightText: "Shared concepts: current note links to a related diary note.",
                sourceFile: "Diary-2023-04-03.md",
                sourceTitle: "Diary-2023-04-03",
            }],
            extra: {
                connections: [{
                    fromNote: "2.fleeting/Test-2023-04-08.md",
                    toNote: "Diary-2023-04-03.md",
                    strength: "medium",
                    sharedConcepts: ["diary thread"],
                }],
            },
        });

        const contentEl = view.contentEl as unknown as FakeElement;
        expect(mockMarkdownRender).not.toHaveBeenCalled();
        expect(contentEl.textContent).toContain("Connection Map");
        expect(contentEl.textContent).toContain("Discovered Connections");
        expect(contentEl.textContent).toContain("Test-2023-04-08");
        expect(contentEl.textContent).toContain("Diary-2023-04-03");
        expect(contentEl.querySelector(".pa-pagelet-panel-connection-graph")).not.toBeNull();
        expect(contentEl.querySelectorAll(".pa-pagelet-panel-connection-node")).toHaveLength(2);
        expect(contentEl.querySelectorAll(".pa-pagelet-panel-connection-edge")).toHaveLength(1);
        expect(contentEl.textContent).not.toContain("No findings yet");
    });

    it("renders periodic summary markdown in the native detail tab", async () => {
        const view = new PageletDetailView({} as never, () => "en");
        const markdown = [
            "# Periodic Summary",
            "",
            "## Summary",
            "A concise periodic summary.",
            "",
            "- First insight",
        ].join("\n");

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "summary",
            content: [{
                title: "pagelet-weekly-review.md",
                description: "Raw finding text should not render in the summary tab.",
            }],
            extra: { markdown },
            sourcePath: ".pagelet/pagelet-weekly-review.md",
        });

        const contentEl = view.contentEl as unknown as FakeElement;
        expect(mockMarkdownRender).toHaveBeenCalledTimes(1);
        expect(mockMarkdownRender).toHaveBeenCalledWith(
            expect.anything(),
            markdown,
            expect.anything(),
            ".pagelet/pagelet-weekly-review.md",
            expect.anything(),
        );
        expect(contentEl.querySelector(".pa-pagelet-panel-summary-preview")).not.toBeNull();
        expect(contentEl.textContent).toContain("Periodic Summary Preview");
        expect(contentEl.textContent).toContain("A concise periodic summary.");
        expect(contentEl.textContent).not.toContain("1 findings found");
        expect(contentEl.textContent).not.toContain("Raw finding text should not render");
    });

    it("saves periodic summary markdown from the native detail tab", async () => {
        const markdown = "# Periodic Summary\n\nA concise periodic summary.";
        const summarySaveNote = {
            fileName: "pagelet-weekly-review.md",
            markdown,
            targetFolder: ".pagelet",
            targetPath: ".pagelet/pagelet-weekly-review.md",
            sources: ["notes/current.md"],
            tokenCost: { input: 1, output: 2 },
        };
        const saveSummary = jest.fn(async (_note: typeof summarySaveNote) => ({
            success: true,
            filePath: ".pagelet/pagelet-weekly-review.md",
        }));
        const view = new PageletDetailView({} as never, () => "en", saveSummary);

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "summary",
            content: [],
            extra: { markdown },
            sourcePath: summarySaveNote.targetPath,
            summarySaveNote,
        });

        const contentEl = view.contentEl as unknown as FakeElement;
        const saveButton = contentEl.querySelector(".pa-pagelet-tab-summary-save");
        expect(saveButton).not.toBeNull();
        expect(saveButton?.textContent).toBe("Save as review note");

        await saveButton?.click();

        expect(saveSummary).toHaveBeenCalledWith(summarySaveNote);
        expect(saveButton?.disabled).toBe(true);
        expect(saveButton?.getAttribute("aria-busy")).toBeNull();
        expect(saveButton?.textContent).toBe("Saved");
        const stateText = JSON.stringify(view.getState());
        expect(stateText).not.toContain(markdown);
        expect((view.getState() as { payload?: { summarySaveNote?: unknown } }).payload?.summarySaveNote).toBeUndefined();
    });

    it("restores unsaved summary markdown from the in-memory native detail session", async () => {
        const markdown = "# Periodic Summary\n\nA concise periodic summary.";
        const summarySaveNote = {
            fileName: "pagelet-weekly-review.md",
            markdown,
            targetFolder: ".pagelet",
            targetPath: ".pagelet/pagelet-weekly-review.md",
            sources: ["notes/current.md"],
            tokenCost: { input: 1, output: 2 },
        };
        const view = new PageletDetailView({} as never, () => "en");

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "summary",
            content: [],
            extra: { markdown },
            sourcePath: summarySaveNote.targetPath,
            summarySaveNote,
        });

        const state = view.getState();
        const stateText = JSON.stringify(state);
        expect(stateText).not.toContain(markdown);
        expect(stateText).not.toContain("summarySaveNote");
        expect(stateText).toContain(summarySaveNote.targetPath);

        const restored = new PageletDetailView({} as never, () => "en");
        await restored.onOpen();
        await restored.setState(state, {} as never);

        const contentEl = restored.contentEl as unknown as FakeElement;
        expect(contentEl.textContent).toContain("Periodic Summary Preview");
        expect(contentEl.textContent).toContain("A concise periodic summary.");
        expect(contentEl.textContent).not.toContain("Result no longer available");
    });

    it("restores discovery payloads from the in-memory native detail session", async () => {
        const view = new PageletDetailView({} as never, () => "en");

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "discover",
            content: [{
                title: "Diary thread",
                description: "Shared diary thread",
                insightText: "Shared concepts: current note links to a related diary note.",
                sourceFile: "Diary-2023-04-03.md",
                sourceTitle: "Diary-2023-04-03",
                actions: [{
                    label: "Non serializable action",
                    callback: () => undefined,
                }],
            }],
            extra: {
                connections: [{
                    fromNote: "2.fleeting/Test-2023-04-08.md",
                    toNote: "Diary-2023-04-03.md",
                    strength: "medium",
                    sharedConcepts: ["diary thread"],
                }],
            },
        });
        const serializedState = JSON.parse(JSON.stringify(view.getState()));
        expect(JSON.stringify(serializedState)).not.toContain("Non serializable action");
        expect(JSON.stringify(serializedState)).not.toContain("Diary thread");
        expect(JSON.stringify(serializedState)).not.toContain("diary thread");

        const restored = new PageletDetailView({} as never, () => "en");
        await restored.onOpen();
        await restored.setState(serializedState, {} as never);

        const contentEl = restored.contentEl as unknown as FakeElement;
        expect(contentEl.textContent).not.toContain("Result no longer available");
        expect(contentEl.textContent).toContain("Connection Map");
        expect(contentEl.textContent).toContain("Discovered Connections");
        expect(contentEl.textContent).toContain("Test-2023-04-08");
        expect(contentEl.textContent).toContain("Diary-2023-04-03");
        expect(contentEl.querySelector(".pa-pagelet-panel-connection-graph")).not.toBeNull();
    });

    it("shows the unavailable state when the native detail session is not in memory", async () => {
        const view = new PageletDetailView({} as never, () => "en");

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "discover",
            content: [{
                title: "Diary thread",
                description: "Shared diary thread",
                insightText: "Shared concepts: current note links to a related diary note.",
                sourceFile: "Diary-2023-04-03.md",
                sourceTitle: "Diary-2023-04-03",
            }],
            extra: {
                connections: [{
                    fromNote: "2.fleeting/Test-2023-04-08.md",
                    toNote: "Diary-2023-04-03.md",
                    strength: "medium",
                    sharedConcepts: ["diary thread"],
                }],
            },
        });

        const serializedState = JSON.parse(JSON.stringify(view.getState()));
        serializedState.payload.sessionId = "missing-session";

        const restored = new PageletDetailView({} as never, () => "en");
        await restored.onOpen();
        await restored.setState(serializedState, {} as never);

        const contentEl = restored.contentEl as unknown as FakeElement;
        expect(contentEl.textContent).toContain("Result no longer available");
        expect(contentEl.textContent).toContain("open a saved review or summary note");
        expect(contentEl.textContent).not.toContain("Connection Map");
        expect(contentEl.querySelector(".pa-pagelet-panel-connection-graph")).toBeNull();
    });

    it("does not persist panel-only extra fields in native detail state", async () => {
        const view = new PageletDetailView({} as never, () => "en");
        const connections = [{
            fromNote: "2.fleeting/Test-2023-04-08.md",
            toNote: "Diary-2023-04-03.md",
            strength: "medium" as const,
            sharedConcepts: ["diary thread"],
        }];

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "discover",
            content: [],
            extra: {
                connections,
                scope: {
                    range: "last7",
                    candidates: [],
                    includedCount: 0,
                    skippedCount: 0,
                },
            } as never,
        });

        const state = view.getState() as { payload?: { extra?: Record<string, unknown> } };
        expect(state.payload?.extra).toBeUndefined();
        expect(JSON.stringify(state)).not.toContain("diary thread");
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
            getLocale: () => "en",
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

    it("keeps panel header icon tooltips on title while sr-only text provides names", async () => {
        const toggleHints = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onToggleHints: toggleHints,
            },
            getLocale: () => "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("review", []);

        const root = container.querySelector(".pa-pagelet-panel");
        const title = container.querySelector(".pa-pagelet-panel-title");
        const buttons = container.querySelectorAll(".pa-pagelet-panel-icon-btn");

        expect(root?.getAttribute("aria-label")).toBeNull();
        expect(root?.getAttribute("aria-labelledby")).toBe(title?.getAttribute("id"));
        expect(buttons).toHaveLength(3);
        expect(buttons.map((button) => button.getAttribute("title"))).toEqual([
            "Hints: Off",
            "Expand to tab",
            "Close",
        ]);
        expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
            null,
            null,
            null,
        ]);
        expect(buttons.map((button) => button.querySelector(".pa-sr-only")?.textContent)).toEqual([
            "Hints: Off",
            "Expand to tab",
            "Close",
        ]);

        await buttons[0]?.click();

        expect(toggleHints).toHaveBeenCalledTimes(1);
        expect(buttons[0]?.getAttribute("title")).toBe("Hints: On");
        expect(buttons[0]?.querySelector(".pa-sr-only")?.textContent).toBe("Hints: On");
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
            getLocale: () => "en",
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
            getLocale: () => "en",
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
            getLocale: () => "en",
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

    it("renders discovery note connections as an interactive SVG graph", async () => {
        const relatedNoteClick = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onRelatedNoteClick: relatedNoteClick,
            },
            getLocale: () => "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("discover", [{
            title: "Current note 'Test-2023-04-08' links to",
            description: "Finding prose should not become a graph node.",
        }], {
            sourcePath: "2.fleeting/Test-2023-04-08.md",
            connections: [
                {
                    fromNote: "2.fleeting/Test-2023-04-08.md",
                    toNote: "Diary-2023-04-03.md",
                    strength: "medium",
                    sharedConcepts: ["diary thread"],
                },
                {
                    fromNote: "2.fleeting/Test-2023-04-08.md",
                    toNote: "PA-Memory/vault-insights.md",
                    strength: "strong",
                    sharedConcepts: ["tag1"],
                },
            ],
        });

        expect(mockMarkdownRender).not.toHaveBeenCalled();
        const graph = container.querySelector(".pa-pagelet-panel-connection-graph");
        expect(graph).not.toBeNull();
        expect(graph?.getAttribute("role")).toBe("group");
        expect(graph?.getAttribute("aria-label")).toBe("Note connection graph");
        expect(container.querySelector(".pa-pagelet-panel-connection-mermaid")).toBeNull();

        const nodes = container.querySelectorAll(".pa-pagelet-panel-connection-node");
        const edges = container.querySelectorAll(".pa-pagelet-panel-connection-edge");
        const dots = container.querySelectorAll(".pa-pagelet-panel-connection-node-dot");
        expect(nodes).toHaveLength(3);
        expect(edges).toHaveLength(2);
        expect(dots.map((dot) => dot.getAttribute("r"))).toEqual(["3.5", "2.75", "2.75"]);
        expect(nodes.map((node) => node.getAttribute("data-note-path"))).toEqual([
            "2.fleeting/Test-2023-04-08.md",
            "Diary-2023-04-03.md",
            "PA-Memory/vault-insights.md",
        ]);
        expect(nodes[0]?.getAttribute("role")).toBe("button");
        expect(nodes[0]?.getAttribute("aria-label")).toBeNull();
        const firstNodeTitle = nodes[0]?.querySelector("title");
        expect(firstNodeTitle?.textContent).toBe("2.fleeting/Test-2023-04-08.md");
        expect(nodes[0]?.getAttribute("aria-labelledby")).toBe(firstNodeTitle?.getAttribute("id"));
        expect(edges.map((edge) => edge.getAttribute("data-strength"))).toEqual(["medium", "strong"]);
        expect(container.textContent).toContain("Test-2023-04-08");
        expect(container.textContent).toContain("Diary-2023-04-03");
        expect(container.textContent).toContain("vault-insights");
        expect(container.textContent).not.toContain("Current note");

        await nodes[1]?.click();
        expect(relatedNoteClick).toHaveBeenCalledWith(
            "Diary-2023-04-03.md",
            "2.fleeting/Test-2023-04-08.md",
        );
    });

    it("expires Discovery graph drag click suppression before the next intentional click", async () => {
        jest.useFakeTimers();
        try {
            const relatedNoteClick = jest.fn();
            const container = new FakeElement("div");
            container.isConnected = true;
            const panel = new PanelView({
                app: {} as never,
                callbacks: {
                    onClose: () => undefined,
                    onExpandToTab: () => undefined,
                    onSaveAsReviewNote: async () => undefined,
                    onSourceClick: () => undefined,
                    onRelatedNoteClick: relatedNoteClick,
                },
                getLocale: () => "en",
            });

            panel.mount(container as unknown as HTMLElement);
            panel.open("discover", [{
                title: "Diary thread",
                description: "Finding prose should not become a graph node.",
            }], {
                sourcePath: "2.fleeting/Test-2023-04-08.md",
                connections: [{
                    fromNote: "2.fleeting/Test-2023-04-08.md",
                    toNote: "Diary-2023-04-03.md",
                    strength: "medium",
                    sharedConcepts: ["diary thread"],
                }],
            });

            const graph = container.querySelector(".pa-pagelet-panel-connection-graph");
            const node = container.querySelectorAll(".pa-pagelet-panel-connection-node")[1];
            expect(graph).not.toBeNull();
            expect(node).not.toBeUndefined();

            await node?.dispatch("pointerdown", {
                pointerId: 1,
                pointerType: "mouse",
                clientX: 20,
                clientY: 20,
            });
            await graph?.dispatch("pointermove", {
                pointerId: 1,
                pointerType: "mouse",
                clientX: 60,
                clientY: 60,
            });
            await graph?.dispatch("pointerup", {
                pointerId: 1,
                pointerType: "mouse",
                clientX: 60,
                clientY: 60,
            });

            expect(node?.getAttribute("data-suppress-click")).toBe("true");
            jest.advanceTimersByTime(251);
            expect(node?.getAttribute("data-suppress-click")).toBeNull();

            await node?.click();

            expect(relatedNoteClick).toHaveBeenCalledWith(
                "Diary-2023-04-03.md",
                "2.fleeting/Test-2023-04-08.md",
            );
        } finally {
            jest.useRealTimers();
        }
    });

    it("uses explicit Discovery source path as the current graph node", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onRelatedNoteClick: () => undefined,
            },
            getLocale: () => "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("discover", [{
            title: "Current note",
            description: "Finding prose should not become a graph node.",
        }], {
            sourcePath: "notes/current.md",
            connections: [{
                fromNote: "notes/other.md",
                toNote: "notes/current.md",
                strength: "medium",
                sharedConcepts: ["shared concept"],
            }],
        });

        const nodes = container.querySelectorAll(".pa-pagelet-panel-connection-node");
        expect(nodes.map((node) => node.getAttribute("data-note-path"))).toEqual([
            "notes/current.md",
            "notes/other.md",
        ]);
        expect(nodes[0]?.classList.contains("pa-pagelet-panel-connection-node--current")).toBe(true);
    });

    it("does not turn Discovery status copy into clickable graph nodes", () => {
        const relatedNoteClick = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onRelatedNoteClick: relatedNoteClick,
            },
            getLocale: () => "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("discover", [{
            title: "Enable Memory to Discover Connections",
            description: "Discovery needs Memory to be prepared first.",
            insightText: "Discovery needs Memory to be prepared first.",
            sourceFile: "",
            sourceTitle: "",
        }], {});

        expect(container.querySelector(".pa-pagelet-panel-connection-graph")).toBeNull();
        expect(container.querySelectorAll(".pa-pagelet-panel-connection-node")).toHaveLength(0);
        expect(container.textContent).toContain("No connection graph yet.");
        expect(container.textContent).toContain("Enable Memory to Discover Connections");
        expect(relatedNoteClick).not.toHaveBeenCalled();
    });
});
