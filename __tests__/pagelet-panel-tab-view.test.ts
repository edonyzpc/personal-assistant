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
    scrollTop = 0;
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
        if (this.children.length === 0) this.scrollTop = 0;
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
const originalConfirm = globalRecord.confirm;

globalRecord.HTMLElement = FakeElement;
globalRecord.document = new FakeDocument();
globalRecord.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0);
    return 0;
};

import { PanelView } from "../src/pagelet/panel/PanelView";
import { TabView } from "../src/pagelet/tab/TabView";
import {
    createContextPagerStateFromRetrievalOutcome,
    type ConfirmedMemoryRecord,
    type MaintenanceMoveApplyResult,
    type MaintenanceMoveUndoResult,
    type MaintenanceProposal,
    type QuietRecallCandidate,
    type ReviewQueueItem,
    type RetrievalOutcome,
    type SavedInsight,
} from "../src/pa";
import {
    PAGELET_DETAIL_ICON,
    PAGELET_DETAIL_VIEW_TYPE,
    PageletDetailView,
} from "../src/pagelet/tab/PageletDetailView";

describe("Pagelet panel and tab view regressions", () => {
    beforeEach(() => {
        globalRecord.document = new FakeDocument();
        globalRecord.confirm = originalConfirm;
        mockMarkdownRender.mockClear();
    });

    afterAll(() => {
        globalRecord.document = originalDocument;
        globalRecord.requestAnimationFrame = originalRequestAnimationFrame;
        globalRecord.confirm = originalConfirm;
    });

    function makeReviewQueueItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
        const status = overrides.status ?? "suggested";
        return {
            id: overrides.id ?? `rq-${status}`,
            type: overrides.type ?? "evidence_insight",
            title: overrides.title ?? "Source-backed insight",
            claim: overrides.claim ?? "This note could use clearer evidence.",
            scope: overrides.scope ?? { kind: "current_note", paths: ["notes/current.md"] },
            sourceRefs: overrides.sourceRefs ?? [{
                path: "notes/current.md",
                excerptHash: "abc123",
                whyShown: ["Saved from Pagelet review"],
                evidenceStrength: "medium",
            }],
            originSurface: overrides.originSurface ?? "pagelet",
            priority: overrides.priority ?? "normal",
            status,
            createdAt: overrides.createdAt ?? "2026-06-28T12:00:00.000Z",
            updatedAt: overrides.updatedAt ?? "2026-06-28T12:00:00.000Z",
            whyShown: overrides.whyShown ?? ["Saved from Pagelet review"],
            dataBoundarySnapshotId: overrides.dataBoundarySnapshotId ?? "boundary-test",
            admissionReason: overrides.admissionReason ?? "user_kept_for_later",
            replayRef: overrides.replayRef,
            metadata: overrides.metadata,
            snoozedUntil: overrides.snoozedUntil,
        };
    }

    function makeContextPagerState() {
        const outcome: RetrievalOutcome = {
            id: "pagelet-context",
            status: "partial_evidence",
            sources: [{
                path: "notes/current.md",
                whyShown: ["current note"],
                excerptHash: "abc123",
            }],
            skippedSources: [{
                path: "private/secret.md",
                excerptHash: "def456",
                skippedReason: "data_boundary",
                boundaryReason: "denied_by_data_boundary",
                privateTitle: "Excluded source",
            }],
            missingScopeHints: ["1 note skipped"],
        };
        return createContextPagerStateFromRetrievalOutcome(outcome, { runId: "pagelet-run" });
    }

    function makeSavedInsight(overrides: Partial<SavedInsight> = {}): SavedInsight {
        return {
            id: overrides.id ?? "ins-1",
            type: overrides.type ?? "theme",
            text: overrides.text ?? "Pricing notes keep coming back.",
            origin: overrides.origin ?? "pa-generated",
            sourceRefs: overrides.sourceRefs ?? [{
                path: "notes/current.md",
                excerptHash: "abc123",
                whyShown: ["Recurring theme"],
                evidenceStrength: "medium",
            }],
            whyShown: overrides.whyShown ?? ["Recurring theme"],
            scope: overrides.scope ?? { kind: "current_note", paths: ["notes/current.md"] },
            status: overrides.status ?? "active",
            influencePolicy: "weak-only",
            createdAt: overrides.createdAt ?? "2026-06-28T12:00:00.000Z",
            updatedAt: overrides.updatedAt ?? "2026-06-28T12:00:00.000Z",
            dataBoundarySnapshotId: overrides.dataBoundarySnapshotId,
            replayRef: overrides.replayRef,
            promotedTo: overrides.promotedTo,
        };
    }

    function makeMemoryRecord(overrides: Partial<ConfirmedMemoryRecord> = {}): ConfirmedMemoryRecord {
        const lifecycle = overrides.lifecycle ?? "active";
        return {
            id: overrides.id ?? "mem-1",
            type: overrides.type ?? "preference",
            lifecycle,
            sensitivity: overrides.sensitivity ?? "low",
            summary: overrides.summary ?? (lifecycle === "forgotten_tombstone" ? "" : "Prefers concise weekly planning."),
            sourceRefs: overrides.sourceRefs ?? (lifecycle === "forgotten_tombstone" ? [] : [{
                path: "notes/current.md",
                excerptHash: "def456",
                whyShown: ["Confirmed by user"],
                evidenceStrength: "strong",
            }]),
            scope: overrides.scope ?? { kind: "current_note", paths: ["notes/current.md"], label: "Current note" },
            createdAt: overrides.createdAt ?? "2026-06-28T12:00:00.000Z",
            updatedAt: overrides.updatedAt ?? "2026-06-28T12:00:00.000Z",
            confirmedAt: overrides.confirmedAt,
            archivedAt: overrides.archivedAt,
            forgottenAt: overrides.forgottenAt,
            validFrom: overrides.validFrom,
            validUntil: overrides.validUntil,
            lastVerified: overrides.lastVerified,
            updatePolicy: overrides.updatePolicy,
            confirmationStrength: overrides.confirmationStrength,
            confirmationSource: overrides.confirmationSource,
            tombstoneReason: overrides.tombstoneReason,
        };
    }

    function makeMaintenanceProposal(overrides: Partial<MaintenanceProposal> = {}): MaintenanceProposal {
        return {
            id: overrides.id ?? "maint-1",
            category: overrides.category ?? "inbox_cleanup",
            actionType: overrides.actionType ?? "move",
            title: overrides.title ?? "Review inbox note destination",
            claim: overrides.claim ?? "Inbox/Untitled.md appears to be in an inbox.",
            confidence: overrides.confidence ?? "medium",
            scope: overrides.scope ?? { kind: "current_note", paths: ["Inbox/Untitled.md"] },
            sourceRefs: overrides.sourceRefs ?? [{ path: "Inbox/Untitled.md", evidenceStrength: "medium" }],
            preview: overrides.preview ?? {
                summary: "Preview move.",
                sourcePath: "Inbox/Untitled.md",
                affectedPaths: ["Inbox/Untitled.md", "Notes/Untitled.md"],
                oldPath: "Inbox/Untitled.md",
                newPath: "Notes/Untitled.md",
            },
            undoMetadata: overrides.undoMetadata ?? {
                strategy: "move_back",
                affectedPaths: ["Inbox/Untitled.md", "Notes/Untitled.md"],
                oldPath: "Inbox/Untitled.md",
                newPath: "Notes/Untitled.md",
                reversible: true,
            },
            actionPlan: overrides.actionPlan ?? {
                actionType: "move",
                previewOnly: true,
                applyBoundary: "blocked_until_user_approval",
            },
            whyShown: overrides.whyShown ?? ["Inbox note"],
            dataBoundarySnapshotId: overrides.dataBoundarySnapshotId ?? "boundary",
            generatedAt: overrides.generatedAt ?? "2026-06-28T12:00:00.000Z",
        };
    }

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

    it("registers a quiet compound Pagelet detail tab icon", () => {
        new PageletDetailView({} as never, () => "en");

        const { addIcon: addIconMock } = jest.requireMock("obsidian") as { addIcon: jest.Mock };
        const iconCall = addIconMock.mock.calls.find(([name]) => name === PAGELET_DETAIL_ICON);
        const svg = iconCall?.[1] ?? "";

        expect(svg).toContain('viewBox="0 0 24 24"');
        expect(svg).toContain('stroke-width="2.4"');
        expect(svg).toContain('M3.8 19.25');
        expect(svg).toContain('cx="19.8"');
        expect(svg).toContain('fill="#2f9e44"');
        expect(svg).toContain('fill="#1971c2"');
        expect(svg).toContain('fill="#f08c00"');
        expect(svg).toContain("<circle");
        expect(svg).not.toContain("<rect");
        expect(svg).not.toContain('fill="#e03131"');
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

    it("renders recap markdown in the native detail tab", async () => {
        const view = new PageletDetailView({} as never, () => "en");
        const markdown = [
            "# Scope Recap",
            "",
            "## Summary",
            "A concise source-backed recap.",
            "",
            "- First insight",
        ].join("\n");

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "summary",
            content: [{
                title: "scope-recap.md",
                description: "Raw finding text should not render in the summary tab.",
            }],
            extra: { markdown },
            sourcePath: ".pagelet/scope-recap.md",
        });

        const contentEl = view.contentEl as unknown as FakeElement;
        expect(mockMarkdownRender).toHaveBeenCalledTimes(1);
        expect(mockMarkdownRender).toHaveBeenCalledWith(
            expect.anything(),
            markdown,
            expect.anything(),
            ".pagelet/scope-recap.md",
            expect.anything(),
        );
        expect(contentEl.querySelector(".pa-pagelet-panel-summary-preview")).not.toBeNull();
        expect(contentEl.textContent).toContain("Recap Preview");
        expect(contentEl.textContent).toContain("A concise source-backed recap.");
        expect(contentEl.textContent).not.toContain("1 findings found");
        expect(contentEl.textContent).not.toContain("Raw finding text should not render");
    });

    it("renders Saved Insight and Memory ledger sections in the native detail tab", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");

        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], {
            layoutType: "review",
            extra: {
                savedInsights: {
                    items: [makeSavedInsight()],
                    totalCount: 1,
                },
                memoryGovernance: {
                    records: [
                        makeMemoryRecord(),
                        makeMemoryRecord({
                            id: "mem-forgotten",
                            lifecycle: "forgotten_tombstone",
                            type: "open_question",
                            summary: "",
                            sourceRefs: [],
                            forgottenAt: "2026-06-28T12:30:00.000Z",
                            tombstoneReason: "user_forget",
                        }),
                    ],
                    totalCount: 2,
                },
            },
        });

        expect(container.querySelector(".pa-pagelet-tab-saved-insights")).not.toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-governance")).not.toBeNull();
        expect(container.textContent).toContain("Saved Insights");
        expect(container.textContent).toContain("Pricing notes keep coming back.");
        expect(container.textContent).toContain("recall only");
        expect(container.textContent).toContain("Memory");
        expect(container.textContent).toContain("Prefers concise weekly planning.");
        expect(container.textContent).toContain("Forgotten memory marker");
        expect(container.textContent).not.toContain("No findings yet");
    });

    it("renders pending Memory candidates and handles candidate actions", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const candidate = makeReviewQueueItem({
            id: "rq-memory",
            type: "memory_candidate",
            title: "Remember preference",
            claim: "Prefers concise planning notes.",
            admissionReason: "memory_confirmation_required",
            metadata: {
                memoryType: "preference",
                sensitivity: "low",
            },
        });
        const confirmCandidate = jest.fn(async (_item: ReviewQueueItem) => ({
            ok: true,
            message: "Confirmed",
        }));
        const dismissCandidate = jest.fn(async (_item: ReviewQueueItem) => ({
            ok: true,
            message: "Dismissed",
        }));
        const tab = new TabView("en", {
            onConfirmMemoryCandidate: confirmCandidate,
            onDismissMemoryCandidate: dismissCandidate,
        });

        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [],
                    candidates: [candidate],
                    totalCount: 1,
                },
            },
        });

        expect(container.querySelector(".pa-pagelet-tab-memory-candidates")).not.toBeNull();
        expect(container.textContent).toContain("Memory candidates");
        expect(container.textContent).toContain("Prefers concise planning notes.");
        expect(container.textContent).not.toContain("No memory candidates pending");

        await container.querySelector(".pa-pagelet-tab-memory-confirm")?.click();

        expect(confirmCandidate).toHaveBeenCalledWith(candidate);
        expect(container.textContent).toContain("Confirmed");
        expect(dismissCandidate).not.toHaveBeenCalled();
    });

    it("allows low-burden batch confirmation for visible Memory candidates", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const confirmPrompt = jest.fn((_message?: string) => true);
        globalRecord.confirm = confirmPrompt;
        const firstCandidate = makeReviewQueueItem({
            id: "rq-memory-first",
            type: "memory_candidate",
            title: "Remember first preference",
            claim: "Prefers concise planning notes.",
            admissionReason: "memory_confirmation_required",
            metadata: { memoryType: "preference", sensitivity: "low" },
        });
        const secondCandidate = makeReviewQueueItem({
            id: "rq-memory-second",
            type: "memory_candidate",
            title: "Remember second preference",
            claim: "Prefers source-backed decisions.",
            admissionReason: "memory_confirmation_required",
            metadata: { memoryType: "preference", sensitivity: "low" },
        });
        const confirmCandidate = jest.fn(async (_item: ReviewQueueItem) => ({
            ok: true,
            message: "Confirmed",
        }));
        const tab = new TabView("en", {
            onConfirmMemoryCandidate: confirmCandidate,
        });

        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [],
                    candidates: [firstCandidate, secondCandidate],
                    totalCount: 2,
                },
            },
        });

        const confirmAllButton = container.querySelector(".pa-pagelet-tab-memory-confirm-all");
        expect(confirmAllButton?.textContent).toBe("Confirm visible (2)");
        const confirmButtons = container.querySelectorAll(".pa-pagelet-tab-memory-confirm");
        expect(confirmButtons).toHaveLength(2);

        await confirmAllButton?.click();
        for (let index = 0; index < 8; index += 1) {
            await Promise.resolve();
        }

        expect(confirmPrompt).toHaveBeenCalledWith(expect.stringContaining("2 visible Memory suggestions"));
        expect(confirmCandidate).toHaveBeenCalledTimes(2);
        expect(confirmCandidate).toHaveBeenNthCalledWith(1, firstCandidate);
        expect(confirmCandidate).toHaveBeenNthCalledWith(2, secondCandidate);
    });

    it("renders preview-only Maintenance Review results in the native detail tab", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");

        tab.mount(container as unknown as HTMLElement);
        tab.open("Maintenance Review", [], {
            layoutType: "review",
            extra: {
                maintenanceReview: {
                    generatedAt: "2026-06-28T12:00:00.000Z",
                    previewOnly: true,
                    weeklyScanEnabled: false,
                    totalCount: 1,
                    categories: [
                        { category: "inbox_cleanup", label: "inbox_cleanup", count: 1 },
                        { category: "better_titles", label: "better_titles", count: 0 },
                        { category: "weak_links", label: "weak_links", count: 0 },
                    ],
                    proposals: [{
                        id: "maint-1",
                        category: "inbox_cleanup",
                        actionType: "move",
                        title: "Review inbox note destination",
                        claim: "Inbox/Untitled.md appears to be in an inbox.",
                        confidence: "medium",
                        scope: { kind: "current_note", paths: ["Inbox/Untitled.md"] },
                        sourceRefs: [{ path: "Inbox/Untitled.md", evidenceStrength: "medium" }],
                        preview: {
                            summary: "Preview move.",
                            sourcePath: "Inbox/Untitled.md",
                            affectedPaths: ["Inbox/Untitled.md", "Notes/Untitled.md"],
                            oldPath: "Inbox/Untitled.md",
                            newPath: "Notes/Untitled.md",
                        },
                        undoMetadata: {
                            strategy: "move_back",
                            affectedPaths: ["Inbox/Untitled.md", "Notes/Untitled.md"],
                            oldPath: "Inbox/Untitled.md",
                            newPath: "Notes/Untitled.md",
                            reversible: true,
                        },
                        actionPlan: {
                            actionType: "move",
                            previewOnly: true,
                            applyBoundary: "blocked_until_user_approval",
                        },
                        whyShown: ["Inbox note"],
                        dataBoundarySnapshotId: "boundary",
                        generatedAt: "2026-06-28T12:00:00.000Z",
                    }],
                },
            },
        });

        expect(container.querySelector(".pa-pagelet-tab-maintenance-review")).not.toBeNull();
        expect(container.textContent).toContain("Maintenance Review");
        expect(container.textContent).toContain("Preview only");
        expect(container.textContent).toContain("Weekly scan: configure in Settings");
        expect(container.textContent).toContain("Review inbox note destination");
        expect(container.textContent).toContain("Inbox/Untitled.md");
        expect(container.textContent).toContain("Notes/Untitled.md");
        expect(container.textContent).not.toContain("No findings yet");
    });

    it("applies and undoes one Maintenance Review move from the native detail tab", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const proposal = makeMaintenanceProposal();
        const appliedAction = {
            id: "act-1",
            proposalId: proposal.id,
            reviewQueueItemId: "rq-1",
            actionType: "move" as const,
            status: "applied" as const,
            oldPath: "Inbox/Untitled.md",
            newPath: "Notes/Untitled.md",
            appliedAt: "2026-06-28T12:00:00.000Z",
            sourceRefs: proposal.sourceRefs,
            dataBoundarySnapshotId: "boundary",
            undoStrategy: "move_back" as const,
        };
        const applyMove = jest.fn(async (_proposal: MaintenanceProposal): Promise<MaintenanceMoveApplyResult> => ({
            ok: true,
            action: appliedAction,
            message: "Moved Inbox/Untitled.md to Notes/Untitled.md.",
        }));
        const undoMove = jest.fn(async (_actionId: string): Promise<MaintenanceMoveUndoResult> => ({
            ok: true,
            action: {
                ...appliedAction,
                status: "undone",
                undoneAt: "2026-06-28T12:05:00.000Z",
            },
            message: "Moved Notes/Untitled.md back to Inbox/Untitled.md.",
        }));
        const tab = new TabView("en", {
            onApplyMaintenanceProposal: applyMove,
            onUndoMaintenanceAction: undoMove,
        });

        tab.mount(container as unknown as HTMLElement);
        tab.open("Maintenance Review", [], {
            layoutType: "review",
            extra: {
                maintenanceReview: {
                    generatedAt: "2026-06-28T12:00:00.000Z",
                    previewOnly: true,
                    weeklyScanEnabled: false,
                    totalCount: 1,
                    categories: [{ category: "inbox_cleanup", label: "inbox_cleanup", count: 1 }],
                    proposals: [proposal],
                },
            },
        });

        const applyButton = container.querySelector(".pa-pagelet-tab-maintenance-apply");
        expect(applyButton?.textContent).toBe("Move note");

        await applyButton?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(applyMove).toHaveBeenCalledWith(proposal);
        expect(container.textContent).toContain("Moved");
        const undoButton = container.querySelector(".pa-pagelet-tab-maintenance-undo");
        expect(undoButton?.textContent).toBe("Undo move");

        await undoButton?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(undoMove).toHaveBeenCalledWith("act-1");
        expect(container.textContent).toContain("Move undone");
        expect(container.querySelector(".pa-pagelet-tab-maintenance-apply")).toBeNull();
    });

    it("keeps maintenance action state when another tab section forces a full rerender", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const proposal = makeMaintenanceProposal();
        const appliedAction = {
            id: "act-rerender",
            proposalId: proposal.id,
            reviewQueueItemId: "rq-1",
            actionType: "move" as const,
            status: "applied" as const,
            oldPath: "Inbox/Untitled.md",
            newPath: "Notes/Untitled.md",
            appliedAt: "2026-06-28T12:00:00.000Z",
            sourceRefs: proposal.sourceRefs,
            dataBoundarySnapshotId: "boundary",
            undoStrategy: "move_back" as const,
        };
        let resolveApply: (value: MaintenanceMoveApplyResult) => void = () => undefined;
        const applyPromise = new Promise<MaintenanceMoveApplyResult>((resolve) => {
            resolveApply = resolve;
        });
        const applyMove = jest.fn((_proposal: MaintenanceProposal) => applyPromise);
        const undoMove = jest.fn(async (): Promise<MaintenanceMoveUndoResult> => ({
            ok: false,
            reason: "not_reversible",
            message: "not undone",
        }));
        const tab = new TabView("en", {
            onApplyMaintenanceProposal: applyMove,
            onUndoMaintenanceAction: undoMove,
        });

        tab.mount(container as unknown as HTMLElement);
        tab.open("Maintenance Review", [], {
            layoutType: "review",
            extra: {
                maintenanceReview: {
                    generatedAt: "2026-06-28T12:00:00.000Z",
                    previewOnly: true,
                    weeklyScanEnabled: false,
                    totalCount: 1,
                    categories: [{ category: "inbox_cleanup", label: "inbox_cleanup", count: 1 }],
                    proposals: [proposal],
                },
                patternDetection: {
                    generatedAt: "2026-07-02T12:00:00.000Z",
                    totalCount: 1,
                    patterns: [{
                        id: "pattern-project",
                        patternType: "recurring_tag",
                        title: "Recurring tag: #project",
                        summary: "3 recent notes share #project.",
                        sourceRefs: [{ path: "Projects/A.md", evidenceStrength: "medium" }],
                        whyShown: ["At least 3 recent notes share #project."],
                    }],
                },
            },
        });

        await container.querySelector(".pa-pagelet-tab-maintenance-apply")?.click();
        expect(container.textContent).toContain("Moving...");

        await container.querySelector(".pa-pagelet-tab-pattern-dismiss")?.click();
        expect(container.textContent).toContain("Moving...");

        resolveApply({
            ok: true,
            action: appliedAction,
            message: "Moved Inbox/Untitled.md to Notes/Untitled.md.",
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(applyMove).toHaveBeenCalledWith(proposal);
        expect(container.textContent).toContain("Moved");
        expect(container.querySelector(".pa-pagelet-tab-maintenance-undo")).not.toBeNull();
    });

    it("renders Quiet Recall in panel and tab before Bubble nudges", async () => {
        const candidate: QuietRecallCandidate = {
            id: "qr-ins-1",
            title: "Recall: current",
            summary: "A saved insight may matter now.",
            sourceInsightId: "ins-1",
            sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
            whyNow: ["Source matches the note you are looking at."],
            nextAction: "Compare this saved insight with the current note.",
            relation: "current",
            score: 90,
            generatedAt: "2026-06-29T12:00:00.000Z",
        };
        const quietRecall = {
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 1,
            candidates: [candidate],
        };
        const panelContainer = new FakeElement("div");
        panelContainer.isConnected = true;
        const panel = new PanelView({
            callbacks: {
                onExpandToTab: jest.fn(),
                onClose: jest.fn(),
                onSourceClick: jest.fn(),
                onSaveAsReviewNote: () => undefined,
            },
        });
        panel.mount(panelContainer as unknown as HTMLElement);
        panel.open("current", [], { quietRecall });

        expect(panelContainer.querySelector(".pa-pagelet-panel-quiet-recall")).not.toBeNull();
        expect(panelContainer.textContent).toContain("A saved insight may matter now.");
        expect(panelContainer.textContent).toContain("notes/current.md");

        const tabContainer = new FakeElement("div");
        tabContainer.isConnected = true;
        const linkRecall = jest.fn(async (_candidate: QuietRecallCandidate, _currentPath?: string) => ({
            ok: true,
            message: "Linked",
        }));
        const saveRecall = jest.fn(async (_candidate: QuietRecallCandidate) => ({
            ok: true as const,
            value: {
                id: "ins-saved",
                type: "observation" as const,
                text: "A saved insight may matter now.",
                origin: "pa-recommended" as const,
                sourceRefs: candidate.sourceRefs,
                whyShown: candidate.whyNow,
                scope: { kind: "custom" as const, label: "Quiet Recall" },
                status: "active" as const,
                influencePolicy: "weak-only" as const,
                createdAt: "2026-06-29T12:00:00.000Z",
                updatedAt: "2026-06-29T12:00:00.000Z",
            },
            message: "Recall saved as insight.",
        }));
        const tab = new TabView("en", {
            onLinkRecallCandidate: linkRecall,
            onSaveQuietRecallAsInsight: saveRecall,
        });
        tab.mount(tabContainer as unknown as HTMLElement);
        tab.open("Quiet Recall", [], {
            layoutType: "current",
            extra: { quietRecall },
        });

        expect(tabContainer.querySelector(".pa-pagelet-tab-quiet-recall")).not.toBeNull();
        expect(tabContainer.textContent).toContain("Why now: Source matches the note you are looking at.");
        expect(tabContainer.textContent).toContain("You could: Compare this saved insight with the current note.");
        const linkButton = tabContainer.querySelector(".pa-pagelet-tab-recall-link");
        expect(linkButton?.textContent).toBe("Link to current note");
        const saveButton = tabContainer.querySelector(".pa-pagelet-tab-recall-save");
        expect(saveButton?.textContent).toBe("Save as insight");

        await linkButton?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(linkRecall).toHaveBeenCalledWith(candidate, "notes/current.md");
        expect(tabContainer.querySelector(".pa-pagelet-tab-recall-link")?.textContent).toBe("Linked");
        expect(tabContainer.querySelector(".pa-pagelet-tab-recall-link")?.disabled).toBe(true);

        const refreshedSaveButton = tabContainer.querySelector(".pa-pagelet-tab-recall-save");
        await refreshedSaveButton?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(saveRecall).toHaveBeenCalledWith(candidate);
        expect(tabContainer.textContent).toContain("Recall saved as insight.");
    });

    it("saves recap markdown from the native detail tab", async () => {
        const markdown = "# Scope Recap\n\nA concise source-backed recap.";
        const summarySaveNote = {
            fileName: "scope-recap.md",
            markdown,
            targetFolder: ".pagelet",
            targetPath: ".pagelet/scope-recap.md",
            sources: ["notes/current.md"],
            tokenCost: { input: 1, output: 2 },
        };
        const saveSummary = jest.fn(async (_note: typeof summarySaveNote) => ({
            success: true,
            filePath: ".pagelet/scope-recap.md",
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
        const markdown = "# Scope Recap\n\nA concise source-backed recap.";
        const summarySaveNote = {
            fileName: "scope-recap.md",
            markdown,
            targetFolder: ".pagelet",
            targetPath: ".pagelet/scope-recap.md",
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
        expect(contentEl.textContent).toContain("Recap Preview");
        expect(contentEl.textContent).toContain("A concise source-backed recap.");
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

    it("restores ledger payloads from the in-memory native detail session", async () => {
        const view = new PageletDetailView({} as never, () => "en");

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "review",
            content: [],
            extra: {
                savedInsights: {
                    items: [makeSavedInsight()],
                    totalCount: 1,
                },
                memoryGovernance: {
                    records: [makeMemoryRecord()],
                    candidates: [makeReviewQueueItem({
                        id: "rq-memory",
                        type: "memory_candidate",
                        title: "Remember preference",
                        claim: "Prefers concise planning notes.",
                        admissionReason: "memory_confirmation_required",
                        metadata: {
                            memoryType: "preference",
                            sensitivity: "low",
                        },
                    })],
                    totalCount: 2,
                },
            },
        });
        const serializedState = JSON.parse(JSON.stringify(view.getState()));
        expect(JSON.stringify(serializedState)).not.toContain("Pricing notes");
        expect(JSON.stringify(serializedState)).not.toContain("Prefers concise");

        const restored = new PageletDetailView({} as never, () => "en");
        await restored.onOpen();
        await restored.setState(serializedState, {} as never);

        const contentEl = restored.contentEl as unknown as FakeElement;
        expect(contentEl.textContent).toContain("Saved Insights");
        expect(contentEl.textContent).toContain("Pricing notes keep coming back.");
        expect(contentEl.textContent).toContain("Memory candidates");
        expect(contentEl.textContent).toContain("Prefers concise planning notes.");
        expect(contentEl.textContent).toContain("Prefers concise weekly planning.");
        expect(contentEl.textContent).not.toContain("Result no longer available");
    });

    it("preserves entry reason through native detail state restoration", async () => {
        const candidate: QuietRecallCandidate = {
            id: "qr-entry-reason",
            title: "Recall: current",
            summary: "A saved insight may matter now.",
            sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
            whyNow: ["Source matches the note you are looking at."],
            nextAction: "Compare this saved insight with the current note.",
            relation: "current",
            score: 90,
            generatedAt: "2026-06-29T12:00:00.000Z",
        };
        const view = new PageletDetailView({} as never, () => "en");

        await view.onOpen();
        view.setPayload({
            title: "Quiet Recall",
            locale: "en",
            layoutType: "current",
            content: [],
            entryReason: "quiet-recall",
            extra: {
                memoryGovernance: {
                    records: [makeMemoryRecord()],
                    candidates: [],
                    totalCount: 1,
                },
                quietRecall: {
                    generatedAt: "2026-06-29T12:00:00.000Z",
                    currentPath: "notes/current.md",
                    totalCount: 1,
                    candidates: [candidate],
                },
            },
        });
        const serializedState = JSON.parse(JSON.stringify(view.getState()));
        expect(serializedState.payload.entryReason).toBe("quiet-recall");

        const restored = new PageletDetailView({} as never, () => "en");
        await restored.onOpen();
        await restored.setState(serializedState, {} as never);

        const text = (restored.contentEl as unknown as FakeElement).textContent;
        expect(text.indexOf("A saved insight may matter now.")).toBeGreaterThanOrEqual(0);
        expect(text.indexOf("A saved insight may matter now.")).toBeLessThan(
            text.indexOf("Prefers concise weekly planning."),
        );
    });

    it("renders pattern detection details with clickable source refs and local dismiss", async () => {
        const sourceClick = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en", { onSourcePathClick: sourceClick });

        tab.mount(container as unknown as HTMLElement);
        tab.open("Cross-note patterns", [], {
            layoutType: "review",
            extra: {
                patternDetection: {
                    generatedAt: "2026-07-02T12:00:00.000Z",
                    totalCount: 1,
                    patterns: [{
                        id: "pattern-project",
                        patternType: "recurring_tag",
                        title: "Recurring tag: #project",
                        summary: "3 recent notes share #project.",
                        sourceRefs: [
                            { path: "Projects/A.md", evidenceStrength: "medium" },
                            { path: "Projects/B.md", evidenceStrength: "medium" },
                        ],
                        whyShown: ["At least 3 recent notes share #project."],
                    }],
                },
            },
        });

        expect(container.querySelector(".pa-pagelet-tab-pattern-detection")).not.toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-pattern-card")).not.toBeNull();
        expect(container.textContent).toContain("Recurring tag: #project");
        expect(container.textContent).toContain("Projects/A.md");

        const sourceButton = container.querySelector(".pa-pagelet-tab-source-link");
        await sourceButton?.click();
        expect(sourceClick).toHaveBeenCalledWith("Projects/A.md");

        const dismissButton = container.querySelector(".pa-pagelet-tab-pattern-dismiss");
        await dismissButton?.click();
        expect(container.querySelector(".pa-pagelet-tab-pattern-card")).toBeNull();
        expect(container.textContent).toContain("No patterns left in this view.");
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

        runButton?.click();

        expect(container.textContent).toContain("Reviewing current note...");
        expect(runButton?.disabled).toBe(true);
        expect(runButton?.getAttribute("aria-busy")).toBe("true");

        resolveReview();
        await reviewPromise;
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

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

    it("renders current-scope Review Queue cards in the panel without storing full source text", async () => {
        const sourceClick = jest.fn();
        const dismiss = jest.fn((_id: string) => undefined);
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: sourceClick,
                onReviewQueueItemDismiss: dismiss,
            },
            getLocale: () => "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("current", [], {
            sourcePath: "notes/current.md",
            reviewQueue: {
                totalCount: 1,
                items: [makeReviewQueueItem({
                    title: "AI expansion",
                    claim: "This generated expansion stays separate from the original capture.",
                    metadata: {
                        renderStyle: "ai_callout",
                        aiGenerated: true,
                    },
                })],
            },
        });

        expect(container.querySelector(".pa-pagelet-panel-review-queue")).not.toBeNull();
        expect(container.querySelector(".pa-pagelet-panel-review-queue-card--ai-callout")).not.toBeNull();
        expect(container.textContent).toContain("Saved & Suggested");
        expect(container.textContent).toContain("AI-generated suggestion");
        expect(container.textContent).toContain("This generated expansion stays separate from the original capture.");
        expect(JSON.stringify(panel.currentPanelExtra)).not.toContain("fullProviderOutput");
        expect(JSON.stringify(panel.currentPanelExtra)).not.toContain("promptChunk");
        expect(JSON.stringify(panel.currentPanelExtra)).not.toContain("raw note body");

        const buttons = container.querySelectorAll(".pa-pagelet-panel-review-queue-action");
        await buttons[0]?.click();
        await buttons[1]?.click();

        expect(sourceClick).toHaveBeenCalledWith("notes/current.md");
        expect(dismiss).toHaveBeenCalledWith("rq-suggested");
    });

    it("renders compact Context Pager details in the panel and detail tab", () => {
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
        panel.open("current", [], {
            contextPager: makeContextPagerState(),
        });

        expect(container.querySelector(".pa-pagelet-panel-context-pager")).not.toBeNull();
        expect(container.textContent).toContain("Used 1 sources, 0 memories. 2 skipped.");
        expect(container.textContent).toContain("notes/current.md");
        expect(container.textContent).toContain("privacy excluded");
        expect(container.textContent).not.toContain("raw prompt");

        const tabContainer = new FakeElement("div");
        tabContainer.isConnected = true;
        const tab = new TabView("en");
        tab.mount(tabContainer as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], {
            layoutType: "current",
            extra: { contextPager: makeContextPagerState() },
        });

        expect(tabContainer.textContent).toContain("Used sources");
        expect(tabContainer.textContent).toContain("notes/current.md");
        expect(tabContainer.textContent).not.toContain("No findings yet");
    });

    it("renders routed ReviewQueue items in Memory and Maintenance sections", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");

        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [],
                    totalCount: 2,
                    routedItems: [
                        makeReviewQueueItem({
                            id: "rq-suggested",
                            type: "evidence_insight",
                            status: "suggested",
                            title: "Needs source decision",
                            claim: "Needs a review decision.",
                        }),
                        makeReviewQueueItem({
                            id: "rq-accepted",
                            type: "capture_enrichment",
                            status: "accepted",
                            title: "Ready to apply",
                            claim: "Ready for the next action.",
                            metadata: {
                                renderStyle: "ai_callout",
                                aiGenerated: true,
                            },
                        }),
                    ],
                },
                maintenanceReview: {
                    generatedAt: "",
                    previewOnly: true,
                    weeklyScanEnabled: false,
                    totalCount: 1,
                    categories: [],
                    proposals: [],
                    routedItems: [
                        makeReviewQueueItem({
                            id: "rq-maintenance",
                            type: "maintenance_proposal",
                            status: "suggested",
                            title: "Maintenance task",
                            claim: "Maintenance action needed.",
                        }),
                    ],
                },
            },
        });

        expect(container.textContent).toContain("Memory");
        expect(container.textContent).toContain("Suggestions");
        expect(container.textContent).toContain("Needs a review decision.");
        expect(container.textContent).toContain("Ready for the next action.");
        expect(container.textContent).toContain("AI-generated suggestion");
        expect(container.querySelector(".pa-pagelet-tab-review-queue-card--ai-callout")).not.toBeNull();
        expect(container.textContent).toContain("Maintenance Review");
        expect(container.textContent).toContain("Maintenance action needed.");
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
