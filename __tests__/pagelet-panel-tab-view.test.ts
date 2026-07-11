/* Copyright 2023 edonyzpc */

/**
 * Regression coverage for Pagelet's raw-DOM panel/tab views.
 *
 * The project does not depend on jsdom, so this file installs the tiny DOM
 * subset those bounded view classes need before importing them.
 */

import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";

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
    tabIndex = 0;
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

    get classList(): { add: (...names: string[]) => void; remove: (...names: string[]) => void; contains: (name: string) => boolean } {
        return {
            add: (...names: string[]): void => {
                const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                for (const name of names) classes.add(name);
                this.className = Array.from(classes).join(" ");
            },
            remove: (...names: string[]): void => {
                const remove = new Set(names);
                this.className = this.className
                    .split(/\s+/)
                    .filter((name) => name.length > 0 && !remove.has(name))
                    .join(" ");
            },
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

    prepend<T extends FakeElement>(child: T): T {
        if (child.parent) {
            child.parent.children = child.parent.children.filter((candidate) => candidate !== child);
        }
        child.parent = this;
        child.setConnected(this.isConnected);
        this.children.unshift(child);
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

    focus(_options?: FocusOptions): void {
        (globalThis as unknown as { document: FakeDocument }).document.activeElement = this;
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
            } else if (selector === "[data-pa-memory-focus-key]") {
                if (node.getAttribute("data-pa-memory-focus-key") !== null) matches.push(node);
            } else if (selector === "[data-pa-recall-focus-key]") {
                if (node.getAttribute("data-pa-recall-focus-key") !== null) matches.push(node);
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
    activeElement: FakeElement | null = null;

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
    clearPageletDetailSessionCache,
} from "../src/pagelet/tab/PageletDetailView";

describe("Pagelet panel and tab view regressions", () => {
    beforeEach(() => {
        globalRecord.document = new FakeDocument();
        globalRecord.confirm = originalConfirm;
        clearPageletDetailSessionCache();
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
            originReviewQueueItemId: overrides.originReviewQueueItemId,
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
        expect(container.textContent).toContain("Forgotten. No original content or source is kept here.");
        expect(container.textContent).not.toContain("No findings yet");
    });

    it("forgets a Memory only through the host-owned permanent action callback", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const record = makeMemoryRecord({
            id: "mem-auto",
            confirmationStrength: "auto",
        });
        const forgetMemory = jest.fn(async (_record: ConfirmedMemoryRecord) => ({ ok: true, message: "Removed" }));
        const confirmPrompt = jest.fn((_message?: string) => true);
        globalRecord.confirm = confirmPrompt;
        const tab = new TabView("en", {
            onForgetConfirmedMemory: forgetMemory,
        } as never);

        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [record],
                    totalCount: 1,
                    confirmedMemoryCount: 30,
                },
            },
        });

        expect(container.textContent).not.toContain("Auto-accepted");
        expect(container.textContent).toContain("Forget permanently");
        await container.querySelector(".pa-pagelet-tab-memory-forget")?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();

        expect(confirmPrompt).not.toHaveBeenCalled();
        expect(forgetMemory).toHaveBeenCalledWith(record);
        expect(container.textContent).toContain("Forgotten. No original content or source is kept here.");
        expect(container.textContent).not.toContain("Prefers concise weekly planning.");
    });

    it("renders meaning-first Memory details and routes exact lifecycle, source, settings, and Undo callbacks", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const record = {
            ...makeMemoryRecord(),
            effect: "future_answers" as const,
            useStatus: "active" as const,
            actionPolicy: {
                correct: true,
                pause: true,
                resume: true,
                forget: true,
            },
        };
        const onCorrect = jest.fn(async (_record: ConfirmedMemoryRecord, summary: string) => ({
            ok: true,
            message: "Correction saved",
            record: { ...record, summary },
        }));
        const onPauseUse = jest.fn(async (_record: ConfirmedMemoryRecord) => ({ ok: true, message: "Use paused" }));
        const onResumeUse = jest.fn(async (_record: ConfirmedMemoryRecord) => ({ ok: true, message: "Use resumed" }));
        const onForget = jest.fn(async (_record: ConfirmedMemoryRecord) => ({ ok: true, message: "Forgotten" }));
        const onUndoRecentChange = jest.fn(async (_change: unknown) => ({ ok: true, message: "Change undone" }));
        const onOpenSource = jest.fn();
        const onOpenMemorySettings = jest.fn();
        const tab = new TabView("en", {
            onCorrect,
            onPauseUse,
            onResumeUse,
            onForget,
            onUndoRecentChange,
            onOpenSource,
            onOpenMemorySettings,
        });

        tab.mount(container as unknown as HTMLElement);
        tab.open("Memory", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [record],
                    totalCount: 1,
                    recentChanges: [{
                        id: "change-1",
                        claimId: "mem-recent-target",
                        kind: "correct",
                        occurredAt: "2026-07-10T12:30:00.000Z",
                        summary: "Concise weekly planning was corrected.",
                        sourcePath: "notes/current.md",
                        scopeLabel: "Current note",
                        effect: "future_answers",
                        status: "active",
                        undoAvailable: true,
                    }],
                },
            },
        });

        expect(container.querySelectorAll("h4")[0]?.textContent).toBe("Prefers concise weekly planning.");
        expect(container.textContent).toContain("Can shape future answers");
        expect(container.textContent).toContain("2026-06-28 12:00");
        expect(container.textContent).not.toContain("low sensitivity");
        expect(container.textContent).not.toContain("PreferencePrefers");

        await container.querySelector(".pa-pagelet-tab-source-link")?.click();
        await container.querySelector(".pa-pagelet-tab-memory-settings")?.click();
        await container.querySelector(".pa-pagelet-tab-memory-settings--record")?.click();
        await container.querySelector(".pa-pagelet-tab-memory-settings--change")?.click();
        expect(onOpenSource).toHaveBeenCalledWith("notes/current.md");
        expect(onOpenMemorySettings).toHaveBeenNthCalledWith(1);
        expect(onOpenMemorySettings).toHaveBeenNthCalledWith(2, record.id);
        expect(onOpenMemorySettings).toHaveBeenNthCalledWith(3, "mem-recent-target");

        await container.querySelector(".pa-pagelet-tab-memory-correct")?.click();
        const input = container.querySelector(".pa-pagelet-tab-memory-correction-input");
        expect(input?.value).toBe("Prefers concise weekly planning.");
        expect(input?.getAttribute("data-pa-memory-focus-key")).toBe("record:mem-1:correction-input");
        expect((globalRecord.document as FakeDocument).activeElement).toBe(input);
        if (input) input.value = "Prefer concise source-backed planning.";
        await container.querySelector(".pa-pagelet-tab-memory-correction-save")?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
        expect(onCorrect).toHaveBeenCalledWith(record, "Prefer concise source-backed planning.");
        expect(container.textContent).toContain("Prefer concise source-backed planning.");
        expect((globalRecord.document as FakeDocument).activeElement)
            .toBe(container.querySelector(".pa-pagelet-tab-memory-correct"));
        await container.querySelector(".pa-pagelet-tab-memory-settings--record")?.click();
        expect(onOpenMemorySettings).toHaveBeenNthCalledWith(4, record.id);

        await container.querySelector(".pa-pagelet-tab-memory-pause")?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
        expect(onPauseUse).toHaveBeenCalledWith(record);
        expect(container.textContent).toContain("Paused");
        expect((globalRecord.document as FakeDocument).activeElement)
            .toBe(container.querySelector(".pa-pagelet-tab-memory-resume"));
        const recordFeedback = container.querySelector(".pa-pagelet-tab-memory-action-feedback");
        expect(recordFeedback?.getAttribute("role")).toBe("status");
        expect(recordFeedback?.getAttribute("aria-live")).toBe("polite");
        await container.querySelector(".pa-pagelet-tab-memory-resume")?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
        expect(onResumeUse).toHaveBeenCalledWith(record);
        expect((globalRecord.document as FakeDocument).activeElement)
            .toBe(container.querySelector(".pa-pagelet-tab-memory-pause"));

        await container.querySelector(".pa-pagelet-tab-memory-undo")?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
        expect(onUndoRecentChange).toHaveBeenCalledWith(expect.objectContaining({ id: "change-1" }));
        const recentCard = container.querySelector(".pa-pagelet-tab-memory-change");
        expect(recentCard?.getAttribute("data-pa-memory-focus-key")).toBe("recent:change-1:card");
        expect((globalRecord.document as FakeDocument).activeElement).toBe(recentCard);
        const recentFeedback = recentCard?.querySelector(".pa-pagelet-tab-memory-action-feedback");
        expect(recentFeedback?.getAttribute("role")).toBe("status");
        expect(recentFeedback?.getAttribute("aria-live")).toBe("polite");
        const recentNodes = recentCard?.querySelectorAll("*") ?? [];
        expect(recentNodes.some((node) => (
            /badge|unread|completion|review-debt/.test(node.className)
        ))).toBe(false);
        expect(recentCard?.textContent.toLowerCase()).not.toMatch(
            /\b(?:pending|completed|unread|needs review|review debt)\b/,
        );

        await container.querySelector(".pa-pagelet-tab-memory-forget")?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
        expect(onForget).toHaveBeenCalledWith(record);
        expect(container.textContent).toContain("Forgotten. No original content or source is kept here.");
        expect(container.textContent).not.toContain("Prefer concise source-backed planning.");
        expect((globalRecord.document as FakeDocument).activeElement)
            .toBe(container.querySelector(".pa-pagelet-tab-memory-card"));
        const forgottenSettings = container.querySelector(".pa-pagelet-tab-memory-settings--record");
        expect(forgottenSettings).not.toBeNull();
        await forgottenSettings?.click();
        expect(onOpenMemorySettings).toHaveBeenNthCalledWith(5, record.id);
    });

    it("renders contextual governed Memory with only Correct and exact Settings routing", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const onCorrect = jest.fn(async () => ({ ok: true, message: "Corrected" }));
        const onPauseUse = jest.fn(async () => ({ ok: true, message: "Paused" }));
        const onResumeUse = jest.fn(async () => ({ ok: true, message: "Resumed" }));
        const onForget = jest.fn(async () => ({ ok: true, message: "Forgotten" }));
        const onOpenMemorySettings = jest.fn();
        const tab = new TabView("en", {
            onCorrect,
            onPauseUse,
            onResumeUse,
            onForget,
            onOpenMemorySettings,
        });
        tab.mount(container as unknown as HTMLElement);
        tab.open("Memory", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    governanceMode: "effect_based",
                    contextual: true,
                    records: [{
                        ...makeMemoryRecord(),
                        effect: "stored_not_in_use",
                        useStatus: "stored_not_in_use",
                        durableUseStatus: "active",
                        actionPolicy: {
                            correct: true,
                            pause: false,
                            resume: false,
                            forget: false,
                        },
                    }],
                    recentChanges: [{
                        id: "global-change-must-not-render",
                        claimId: "mem-1",
                        kind: "correct",
                        occurredAt: "2026-07-10T12:00:00.000Z",
                        summary: "Global change",
                        undoAvailable: true,
                    }],
                    totalCount: 1,
                },
            },
        });

        expect(container.textContent).toContain("Saved, not currently used");
        expect(container.textContent).toContain("Saved, not in use");
        expect(container.textContent).not.toContain("Can shape future answers");
        expect(container.textContent).not.toContain("In use");
        expect(container.textContent).not.toContain("Global change");
        expect(container.querySelector(".pa-pagelet-tab-memory-correct")).not.toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-pause")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-resume")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-forget")).toBeNull();
        expect(container.querySelectorAll(".pa-pagelet-tab-memory-settings")).toHaveLength(1);
        await container.querySelector(".pa-pagelet-tab-memory-settings--record")?.click();
        expect(onOpenMemorySettings).toHaveBeenCalledWith("mem-1");
    });

    it("keeps explicit legacy Memory records on the legacy Forget-only action path", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en", {
            onCorrect: jest.fn(async () => ({ ok: true, message: "Corrected" })),
            onPauseUse: jest.fn(async () => ({ ok: true, message: "Paused" })),
            onResumeUse: jest.fn(async () => ({ ok: true, message: "Resumed" })),
            onForget: jest.fn(async () => ({ ok: true, message: "Forgotten" })),
        });
        tab.mount(container as unknown as HTMLElement);
        tab.open("Memory", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    governanceMode: "legacy_threshold",
                    records: [makeMemoryRecord()],
                    totalCount: 1,
                    confirmedMemoryCount: 30,
                },
            },
        });

        expect(container.querySelector(".pa-pagelet-tab-memory-correct")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-pause")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-resume")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-forget")).not.toBeNull();
    });

    it("preserves the contextual governed Memory boundary across detail reload", async () => {
        const onCorrect = jest.fn(async () => ({ ok: true, message: "Corrected" }));
        const onOpenMemorySettings = jest.fn();
        const record = {
            ...makeMemoryRecord(),
            effect: "future_answers" as const,
            useStatus: "active" as const,
            durableUseStatus: "active" as const,
            actionPolicy: {
                correct: true,
                pause: true,
                resume: false,
                forget: true,
            },
        };
        const resolveContextualMemory = jest.fn((_claimIds: readonly string[]) => ({
            governanceMode: "effect_based" as const,
            records: [record],
            recentChanges: [{
                id: "private-change",
                claimId: record.id,
                kind: "correct" as const,
                occurredAt: "2026-07-10T12:00:00.000Z",
                summary: "PRIVATE RECENT CHANGE MUST NOT PERSIST",
            }],
            totalCount: 1,
        }));
        const callbacks = { onCorrect, onOpenMemorySettings, resolveContextualMemory };
        const createView = () => new PageletDetailView(
            {} as never,
            () => "en",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            callbacks,
        );
        const first = createView();
        await first.onOpen();
        first.setPayload({
            title: "Memory",
            content: [],
            locale: "en",
            layoutType: "review",
            sourcePath: "private/context.md",
            extra: {
                memoryGovernance: {
                    governanceMode: "effect_based",
                    contextual: true,
                    records: [record],
                    totalCount: 1,
                },
            },
        });
        const initialContent = first.contentEl as unknown as FakeElement;
        expect(initialContent.querySelector(".pa-pagelet-tab-memory-correct")).not.toBeNull();
        expect(initialContent.querySelector(".pa-pagelet-tab-memory-pause")).toBeNull();
        expect(initialContent.querySelector(".pa-pagelet-tab-memory-resume")).toBeNull();
        expect(initialContent.querySelector(".pa-pagelet-tab-memory-forget")).toBeNull();
        expect(initialContent.querySelector(".pa-pagelet-tab-memory-change")).toBeNull();
        const state = first.getState();
        expect(state).toMatchObject({
            version: 5,
            payload: {
                contextualMemory: {
                    marker: "exact-governed-claims-v1",
                    claimIds: ["mem-1"],
                },
            },
        });
        expect((state as { payload?: { title?: unknown } }).payload?.title).toBeUndefined();
        expect(JSON.stringify(state)).not.toContain(record.summary);
        expect(JSON.stringify(state)).not.toContain("notes/current.md");
        expect(JSON.stringify(state)).not.toContain("private/context.md");
        expect(JSON.stringify(state)).not.toContain("PRIVATE RECENT CHANGE MUST NOT PERSIST");
        clearPageletDetailSessionCache();

        const restored = createView();
        await restored.onOpen();
        await restored.setState(state, {} as never);

        const content = restored.contentEl as unknown as FakeElement;
        expect(content.textContent).toContain("Prefers concise weekly planning.");
        expect(content.querySelector(".pa-pagelet-tab-memory-correct")).not.toBeNull();
        expect(content.querySelector(".pa-pagelet-tab-memory-pause")).toBeNull();
        expect(content.querySelector(".pa-pagelet-tab-memory-resume")).toBeNull();
        expect(content.querySelector(".pa-pagelet-tab-memory-forget")).toBeNull();
        expect(content.querySelectorAll(".pa-pagelet-tab-memory-settings")).toHaveLength(1);
        expect(content.textContent).not.toContain("PRIVATE RECENT CHANGE MUST NOT PERSIST");
        expect(resolveContextualMemory).toHaveBeenCalledWith(["mem-1"]);
        await content.querySelector(".pa-pagelet-tab-memory-settings--record")?.click();
        expect(onOpenMemorySettings).toHaveBeenCalledWith("mem-1");
    });

    it.each([
        ["wrong marker", { marker: "wrong", claimIds: ["mem-1"] }, "present"],
        ["duplicate IDs", {
            marker: "exact-governed-claims-v1",
            claimIds: ["mem-1", "mem-1"],
        }, "present"],
        ["unknown ID", {
            marker: "exact-governed-claims-v1",
            claimIds: ["mem-missing"],
        }, "present"],
        ["removed claim", {
            marker: "exact-governed-claims-v1",
            claimIds: ["mem-1"],
        }, "removed"],
    ] as const)("fails restored contextual Memory closed for %s", async (_label, persisted, source) => {
        const record = {
            ...makeMemoryRecord(),
            effect: "future_answers" as const,
            useStatus: "active" as const,
            durableUseStatus: "active" as const,
            actionPolicy: {
                correct: true,
                pause: true,
                resume: false,
                forget: true,
            },
        };
        const resolveContextualMemory = jest.fn(() => ({
            governanceMode: "effect_based" as const,
            records: source === "removed" ? [] : [record],
            totalCount: source === "removed" ? 0 : 1,
        }));
        const view = new PageletDetailView(
            {} as never,
            () => "en",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { resolveContextualMemory, onOpenMemorySettings: jest.fn() },
        );
        await view.onOpen();
        await view.setState({
            version: 5,
            payload: {
                title: "Memory",
                locale: "en",
                sessionId: `restore-${_label}`,
                restoredFromState: true,
                layoutType: "review",
                contextualMemory: persisted,
            },
        }, {} as never);

        const content = view.contentEl as unknown as FakeElement;
        expect(content.querySelector(".pa-pagelet-tab-memory-card")).toBeNull();
        expect(content.querySelector(".pa-pagelet-tab-memory-settings--record")).toBeNull();
    });

    it.each([
        ["wrong marker", { marker: "invalid-marker", claimIds: ["mem-1"] }],
        ["duplicate IDs", {
            marker: "exact-governed-claims-v1",
            claimIds: ["mem-1", "mem-1"],
        }],
        ["unknown ID", {
            marker: "exact-governed-claims-v1",
            claimIds: ["mem-missing"],
        }],
        ["missing marker", undefined],
    ] as const)("does not let %s reuse a matching in-memory contextual payload", async (
        _label,
        persisted,
    ) => {
        const record = {
            ...makeMemoryRecord(),
            effect: "future_answers" as const,
            useStatus: "active" as const,
            durableUseStatus: "active" as const,
            actionPolicy: {
                correct: true,
                pause: true,
                resume: false,
                forget: true,
            },
        };
        const first = new PageletDetailView({} as never, () => "en");
        await first.onOpen();
        first.setPayload({
            title: "Memory",
            content: [],
            locale: "en",
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    governanceMode: "effect_based",
                    contextual: true,
                    records: [record],
                    totalCount: 1,
                },
            },
        });
        const state = first.getState() as {
            payload: { contextualMemory?: { marker: string; claimIds: readonly string[] } };
        };
        if (persisted) state.payload.contextualMemory = persisted;
        else delete state.payload.contextualMemory;

        const restored = new PageletDetailView({} as never, () => "en", undefined, undefined,
            undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
                resolveContextualMemory: () => ({
                    governanceMode: "effect_based",
                    records: [record],
                    totalCount: 1,
                }),
            });
        await restored.onOpen();
        await restored.setState(state, {} as never);

        const content = restored.contentEl as unknown as FakeElement;
        expect(content.querySelector(".pa-pagelet-tab-memory-card")).toBeNull();
        expect(content.textContent).toContain("Result no longer available");
    });

    it("fails a duplicate live contextual trace closed without persisting its title or path", async () => {
        const record = {
            ...makeMemoryRecord(),
            effect: "future_answers" as const,
            useStatus: "active" as const,
            durableUseStatus: "active" as const,
            actionPolicy: {
                correct: true,
                pause: false,
                resume: false,
                forget: false,
            },
        };
        const view = new PageletDetailView({} as never, () => "en");
        await view.onOpen();
        view.setPayload({
            title: "PRIVATE OLD RESULT",
            content: [{
                title: "PRIVATE OLD FINDING",
                description: "PRIVATE OLD DESCRIPTION",
                insightText: "PRIVATE OLD INSIGHT",
            }],
            locale: "en",
            layoutType: "review",
        });
        view.setPayload({
            title: "PRIVATE DUPLICATE TITLE",
            content: [],
            locale: "en",
            layoutType: "review",
            sourcePath: "private/duplicate.md",
            extra: {
                memoryGovernance: {
                    governanceMode: "effect_based",
                    contextual: true,
                    records: [record, { ...record }],
                    totalCount: 2,
                },
            },
        });

        const content = view.contentEl as unknown as FakeElement;
        const state = view.getState();
        const stateText = JSON.stringify(state);
        expect(content.textContent).toContain("Result no longer available");
        expect(content.textContent).not.toContain(record.summary);
        expect(stateText).not.toContain("PRIVATE DUPLICATE TITLE");
        expect(stateText).not.toContain("private/duplicate.md");
        expect(stateText).not.toContain(record.summary);

        const restored = new PageletDetailView({} as never, () => "en");
        await restored.onOpen();
        await restored.setState(state, {} as never);
        const restoredContent = restored.contentEl as unknown as FakeElement;
        expect(restoredContent.textContent).toContain("Result no longer available");
        expect(restoredContent.textContent).not.toContain("PRIVATE OLD FINDING");
        expect(restoredContent.textContent).not.toContain("PRIVATE OLD INSIGHT");
    });

    it("keeps a contextual candidate-only detail available without inventing a claim trace", async () => {
        const candidate = makeReviewQueueItem({
            id: "candidate-only",
            type: "memory_candidate",
            status: "suggested",
            title: "Remember this preference",
            claim: "Prefers short weekly plans.",
            metadata: {
                memoryType: "preference",
                sensitivity: "low",
            },
        });
        const view = new PageletDetailView({} as never, () => "en");
        await view.onOpen();
        view.setPayload({
            title: "PRIVATE CANDIDATE TITLE",
            content: [],
            locale: "en",
            layoutType: "review",
            sourcePath: "private/candidate-source.md",
            extra: {
                memoryGovernance: {
                    governanceMode: "effect_based",
                    contextual: true,
                    records: [],
                    candidates: [candidate],
                    totalCount: 1,
                },
            },
        });

        const content = view.contentEl as unknown as FakeElement;
        const state = view.getState() as { payload?: { contextualMemory?: unknown } };
        const stateText = JSON.stringify(state);
        expect(content.textContent).toContain("Prefers short weekly plans.");
        expect(content.textContent).not.toContain("Result no longer available");
        expect(state.payload?.contextualMemory).toBeUndefined();
        expect(stateText).not.toContain("PRIVATE CANDIDATE TITLE");
        expect(stateText).not.toContain("private/candidate-source.md");
    });

    it("deletes a non-context cache after an invalid persisted marker so it cannot revive", async () => {
        const first = new PageletDetailView({} as never, () => "en");
        await first.onOpen();
        first.setPayload({
            title: "PRIVATE OLD RESULT",
            content: [{
                title: "PRIVATE OLD FINDING",
                description: "PRIVATE OLD DESCRIPTION",
                insightText: "PRIVATE OLD INSIGHT",
            }],
            locale: "en",
            layoutType: "review",
        });
        const invalidState = first.getState() as {
            payload: { contextualMemory?: unknown };
        };
        invalidState.payload.contextualMemory = {
            marker: "wrong-marker",
            claimIds: ["mem-1"],
        };

        const firstRestore = new PageletDetailView({} as never, () => "en");
        await firstRestore.onOpen();
        await firstRestore.setState(invalidState, {} as never);
        const sanitizedState = firstRestore.getState();
        const firstContent = firstRestore.contentEl as unknown as FakeElement;
        expect(firstContent.textContent).toContain("Result no longer available");
        expect(firstContent.textContent).not.toContain("PRIVATE OLD FINDING");

        const secondRestore = new PageletDetailView({} as never, () => "en");
        await secondRestore.onOpen();
        await secondRestore.setState(sanitizedState, {} as never);
        const secondContent = secondRestore.contentEl as unknown as FakeElement;
        expect(secondContent.textContent).toContain("Result no longer available");
        expect(secondContent.textContent).not.toContain("PRIVATE OLD FINDING");
        expect(secondContent.textContent).not.toContain("PRIVATE OLD INSIGHT");
    });

    it.each(["removed", "throws"] as const)(
        "expires a matching cached contextual payload when the resolver %s",
        async (outcome) => {
            const record = {
                ...makeMemoryRecord(),
                effect: "future_answers" as const,
                useStatus: "active" as const,
                durableUseStatus: "active" as const,
                actionPolicy: {
                    correct: true,
                    pause: true,
                    resume: false,
                    forget: true,
                },
            };
            const first = new PageletDetailView({} as never, () => "en");
            await first.onOpen();
            first.setPayload({
                title: "PRIVATE CACHED TITLE",
                content: [],
                locale: "en",
                layoutType: "current",
                extra: {
                    quietRecall: {
                        generatedAt: "2026-07-10T12:00:00.000Z",
                        currentPath: "private/current.md",
                        totalCount: 1,
                        candidates: [{
                            id: "private-recall",
                            title: "PRIVATE CACHED RECALL",
                            summary: "PRIVATE CACHED SUMMARY",
                            sourceRefs: [{ path: "private/source.md" }],
                            whyNow: ["PRIVATE CACHED REASON"],
                            nextAction: "PRIVATE CACHED NEXT ACTION",
                            relation: "related",
                            score: 80,
                            generatedAt: "2026-07-10T12:00:00.000Z",
                            context: { kind: "governed_claim", claimId: record.id },
                        }],
                    },
                },
            });
            const state = first.getState();

            const restored = new PageletDetailView({} as never, () => "en", undefined,
                undefined, undefined, undefined, undefined, undefined, undefined, undefined,
                undefined, {
                    resolveContextualMemory: () => {
                        if (outcome === "throws") throw new Error("repository unavailable");
                        return {
                            governanceMode: "effect_based",
                            records: [],
                            totalCount: 0,
                        };
                    },
                });
            await restored.onOpen();
            await restored.setState(state, {} as never);

            const content = restored.contentEl as unknown as FakeElement;
            expect(content.textContent).toContain("Result no longer available");
            expect(content.textContent).not.toContain("PRIVATE CACHED RECALL");
            expect(content.textContent).not.toContain("PRIVATE CACHED SUMMARY");
            expect(content.querySelector(".pa-pagelet-tab-memory-card")).toBeNull();
        },
    );

    it("persists only an exact Quiet Recall governed claim ID and rehydrates a minimal route", async () => {
        const record = {
            ...makeMemoryRecord(),
            effect: "future_answers" as const,
            useStatus: "active" as const,
            durableUseStatus: "active" as const,
            actionPolicy: {
                correct: true,
                pause: true,
                resume: false,
                forget: true,
            },
        };
        const resolveContextualMemory = jest.fn(() => ({
            governanceMode: "effect_based" as const,
            records: [record],
            totalCount: 1,
        }));
        const onOpenMemorySettings = jest.fn();
        const createView = () => new PageletDetailView(
            {} as never,
            () => "en",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { resolveContextualMemory, onOpenMemorySettings },
        );
        const first = createView();
        await first.onOpen();
        first.setPayload({
            title: "PRIVATE VIEW TITLE",
            content: [],
            locale: "en",
            layoutType: "current",
            sourcePath: "private/current.md",
            extra: {
                quietRecall: {
                    generatedAt: "2026-07-10T12:00:00.000Z",
                    currentPath: "private/current.md",
                    totalCount: 1,
                    candidates: [{
                        id: "recall-private",
                        title: "PRIVATE RECALL TITLE",
                        summary: "PRIVATE RECALL SUMMARY",
                        sourceRefs: [{ path: "private/source.md" }],
                        whyNow: ["PRIVATE WHY NOW"],
                        nextAction: "PRIVATE NEXT ACTION",
                        relation: "related",
                        score: 80,
                        generatedAt: "2026-07-10T12:00:00.000Z",
                        context: { kind: "governed_claim", claimId: "mem-1" },
                    }],
                },
            },
        });
        const state = first.getState();
        expect(state).toMatchObject({
            payload: {
                contextualMemory: {
                    marker: "exact-governed-claims-v1",
                    claimIds: ["mem-1"],
                },
            },
        });
        for (const privateText of [
            "PRIVATE RECALL TITLE",
            "PRIVATE RECALL SUMMARY",
            "PRIVATE VIEW TITLE",
            "private/current.md",
            "private/source.md",
            "PRIVATE WHY NOW",
            "PRIVATE NEXT ACTION",
        ]) expect(JSON.stringify(state)).not.toContain(privateText);
        clearPageletDetailSessionCache();

        const restored = createView();
        await restored.onOpen();
        await restored.setState(state, {} as never);
        const content = restored.contentEl as unknown as FakeElement;
        expect(content.querySelector(".pa-pagelet-tab-quiet-recall")).toBeNull();
        expect(content.querySelector(".pa-pagelet-tab-memory-card")).not.toBeNull();
        expect(content.querySelector(".pa-pagelet-tab-memory-pause")).toBeNull();
        expect(content.querySelector(".pa-pagelet-tab-memory-forget")).toBeNull();
        await content.querySelector(".pa-pagelet-tab-memory-settings--record")?.click();
        expect(onOpenMemorySettings).toHaveBeenCalledWith("mem-1");
    });

    it("fails governed actions closed when a Pagelet action returns a plain record", async () => {
        const record = {
            ...makeMemoryRecord(),
            effect: "stored_not_in_use" as const,
            useStatus: "stored_not_in_use" as const,
            durableUseStatus: "active" as const,
            actionPolicy: {
                correct: true,
                pause: true,
                resume: false,
                forget: true,
            },
        };
        const onPauseUse = jest.fn(async (_record: ConfirmedMemoryRecord) => ({
            ok: true,
            message: "Paused from host",
            record: makeMemoryRecord({ lifecycle: "archived" }),
        }));
        const onResumeUse = jest.fn(async () => ({ ok: true, message: "Resumed from host" }));
        const view = new PageletDetailView(
            {} as never,
            () => "en",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { onPauseUse, onResumeUse },
        );
        await view.onOpen();
        view.setPayload({
            title: "Memory",
            content: [],
            locale: "en",
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [record],
                    totalCount: 1,
                },
            },
        });

        const content = view.contentEl as unknown as FakeElement;
        expect(content.querySelector(".pa-pagelet-tab-memory-pause")).not.toBeNull();
        expect(content.querySelector(".pa-pagelet-tab-memory-resume")).toBeNull();

        await content.querySelector(".pa-pagelet-tab-memory-pause")?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();

        expect(onPauseUse).toHaveBeenCalledWith(record);
        expect(content.querySelector(".pa-pagelet-tab-memory-resume")).toBeNull();
        expect(onResumeUse).not.toHaveBeenCalled();
        expect(content.textContent).toContain("Saved, not currently used");
    });

    it("passes Memory lifecycle and deep-link callbacks through PageletDetailView", async () => {
        const onPauseUse = jest.fn(async (_record: ConfirmedMemoryRecord) => ({
            ok: true,
            message: "Paused from host",
        }));
        const onOpenSource = jest.fn((_path: string) => undefined);
        const onOpenMemorySettings = jest.fn((_targetId?: string) => undefined);
        const view = new PageletDetailView(
            {} as never,
            () => "en",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { onPauseUse, onOpenSource, onOpenMemorySettings },
        );
        await view.onOpen();
        const record = {
            ...makeMemoryRecord(),
            useStatus: "active" as const,
            actionPolicy: {
                correct: false,
                pause: true,
                resume: false,
                forget: false,
            },
        };
        view.setPayload({
            title: "Memory",
            content: [],
            locale: "en",
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [record],
                    totalCount: 1,
                    recentChanges: [{
                        id: "view-change",
                        claimId: "mem-view-change",
                        kind: "pause",
                        occurredAt: "2026-07-10T12:30:00.000Z",
                        summary: "Use paused.",
                        undoAvailable: false,
                    }],
                },
            },
        });

        const content = view.contentEl as unknown as FakeElement;
        await content.querySelector(".pa-pagelet-tab-source-link")?.click();
        await content.querySelector(".pa-pagelet-tab-memory-settings--record")?.click();
        await content.querySelector(".pa-pagelet-tab-memory-settings--change")?.click();
        await content.querySelector(".pa-pagelet-tab-memory-pause")?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();

        expect(onOpenSource).toHaveBeenCalledWith("notes/current.md");
        expect(onOpenMemorySettings).toHaveBeenNthCalledWith(1, record.id);
        expect(onOpenMemorySettings).toHaveBeenNthCalledWith(2, "mem-view-change");
        expect(onPauseUse).toHaveBeenCalledWith(record);
        expect(content.textContent).toContain("Paused from host");

        await view.onClose();
        await view.onOpen();
        await content.querySelector(".pa-pagelet-tab-memory-settings--record")?.click();
        await content.querySelector(".pa-pagelet-tab-memory-settings--change")?.click();
        expect(onOpenMemorySettings).toHaveBeenNthCalledWith(3, record.id);
        expect(onOpenMemorySettings).toHaveBeenNthCalledWith(4, "mem-view-change");
        await view.onClose();
    });

    it("routes Memory settings to claim IDs from the latest render", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const onOpenMemorySettings = jest.fn((_targetId?: string) => undefined);
        const tab = new TabView("en", { onOpenMemorySettings });
        tab.mount(container as unknown as HTMLElement);

        const renderMemory = (recordId: string, recentClaimId: string): void => {
            tab.open("Memory", [], {
                layoutType: "review",
                extra: {
                    memoryGovernance: {
                        records: [makeMemoryRecord({ id: recordId })],
                        totalCount: 1,
                        recentChanges: [{
                            id: `change-${recentClaimId}`,
                            claimId: recentClaimId,
                            kind: "correct",
                            occurredAt: "2026-07-10T12:30:00.000Z",
                            summary: "Memory updated.",
                            undoAvailable: false,
                        }],
                    },
                },
            });
        };

        renderMemory("mem-first", "mem-change-first");
        await container.querySelector(".pa-pagelet-tab-memory-settings--record")?.click();
        await container.querySelector(".pa-pagelet-tab-memory-settings--change")?.click();
        renderMemory("mem-second", "mem-change-second");
        await container.querySelector(".pa-pagelet-tab-memory-settings--record")?.click();
        await container.querySelector(".pa-pagelet-tab-memory-settings--change")?.click();

        expect(onOpenMemorySettings.mock.calls).toEqual([
            ["mem-first"],
            ["mem-change-first"],
            ["mem-second"],
            ["mem-change-second"],
        ]);
    });

    it("hides unsupported Memory actions and redacts Forget history even if the input carries content", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");
        tab.mount(container as unknown as HTMLElement);
        tab.open("Memory", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [makeMemoryRecord()],
                    totalCount: 1,
                    recentChanges: [{
                        id: "forgotten-change",
                        claimId: "mem-forgotten",
                        kind: "forget",
                        occurredAt: "2026-07-10T12:30:00.000Z",
                        summary: "SECRET FORGOTTEN CONTENT",
                        sourcePath: "private/secret.md",
                        scopeLabel: "Secret folder",
                        effect: "future_answers",
                        status: "forgotten",
                        undoAvailable: true,
                    }],
                },
            },
        });

        expect(container.querySelector(".pa-pagelet-tab-memory-actions")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-settings")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-undo")).toBeNull();
        expect(container.textContent).toContain("Memory forgotten");
        expect(container.textContent).toContain("The forgotten content and its source are no longer available.");
        expect(container.textContent).not.toContain("SECRET FORGOTTEN CONTENT");
        expect(container.textContent).not.toContain("private/secret.md");
        expect(container.textContent).not.toContain("Secret folder");
    });

    it("keeps action failures local and renders an explicit quiet Recent changes empty state", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const onPauseUse = jest.fn(async () => ({ ok: false, message: "Could not pause now" }));
        const tab = new TabView("en", { onPauseUse });
        tab.mount(container as unknown as HTMLElement);
        tab.open("Memory", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [{
                        ...makeMemoryRecord(),
                        useStatus: "active",
                        actionPolicy: {
                            correct: false,
                            pause: true,
                            resume: false,
                            forget: false,
                        },
                    }],
                    totalCount: 1,
                    recentChanges: [],
                },
            },
        });

        expect(container.textContent).toContain("No Memory changes in the last seven days.");
        await container.querySelector(".pa-pagelet-tab-memory-pause")?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();
        const feedback = container.querySelector(".pa-pagelet-tab-memory-action-feedback");
        expect(feedback?.textContent).toBe("Could not pause now");
        expect(feedback?.getAttribute("data-status")).toBe("failed");
        expect(feedback?.getAttribute("role")).toBe("status");
        expect(feedback?.getAttribute("aria-live")).toBe("polite");
        expect((globalRecord.document as FakeDocument).activeElement)
            .toBe(container.querySelector(".pa-pagelet-tab-memory-pause"));
        expect(container.textContent).toContain("In use");
    });

    it("keeps Memory controls scoped and touch-sized on mobile", () => {
        const css = readFileSync("src/custom.pcss", "utf8");
        expect(css).toMatch(/body\.is-mobile \.pa-pagelet-tab-memory-action,[\s\S]*?min-height:\s*44px;/);
        expect(css).toMatch(/body\.is-mobile \.pa-pagelet-tab-memory-actions,[\s\S]*?flex-direction:\s*column;/);
        expect(css).toContain(".pa-pagelet-tab-memory-correction-input");
        expect(css).not.toContain(".workspace .pa-pagelet-tab-memory-action");
        const tombstoneRule = css.match(/\.pa-pagelet-tab-memory-card--tombstone\s*\{[^}]*\}/)?.[0] ?? "";
        expect(tombstoneRule).not.toMatch(/pointer-events:\s*none/);
    });

    it("keeps effect-based Pagelet limited to per-item candidate review", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const candidates = [1, 2, 3].map((index) => makeReviewQueueItem({
            id: `rq-effect-${index}`,
            type: "memory_candidate",
            title: `Review preference ${index}`,
            claim: `Effect candidate ${index}.`,
            admissionReason: "memory_confirmation_required",
            metadata: {
                memoryType: "preference",
                sensitivity: "low",
                memorySource: index === 1 ? "notes" : index === 2 ? "interactions" : "unknown",
                memoryScope: "current_vault",
                memoryEffect: index === 1 ? "future_answers" : "stored_not_in_use",
            },
        }));
        const tab = new TabView("en", {
            onConfirmMemoryCandidate: jest.fn(async () => ({ ok: true, message: "Confirmed" })),
            onDismissMemoryCandidate: jest.fn(async () => ({ ok: true, message: "Dismissed" })),
            onCorrect: jest.fn(async () => ({ ok: true, message: "Corrected" })),
            onPauseUse: jest.fn(async () => ({ ok: true, message: "Paused" })),
            onForget: jest.fn(async () => ({ ok: true, message: "Forgotten" })),
            onUndoRecentChange: jest.fn(async () => ({ ok: true, message: "Undone" })),
            onOpenMemorySettings: jest.fn(),
        });

        tab.mount(container as unknown as HTMLElement);
        tab.open("Memory", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    governanceMode: "effect_based",
                    records: [makeMemoryRecord({ summary: "DURABLE RECORD MUST STAY IN SETTINGS" })],
                    candidates,
                    totalCount: 34,
                    confirmedMemoryCount: 30,
                    recentChanges: [{
                        id: "event-private",
                        claimId: "mem-1",
                        kind: "correct",
                        occurredAt: "2026-07-10T12:00:00.000Z",
                        summary: "RECENT CHANGE MUST STAY IN SETTINGS",
                        sourcePath: "private/recent.md",
                        undoAvailable: true,
                    }],
                },
            },
        });

        expect(container.textContent).toContain("Effect candidate 1.");
        expect(container.querySelectorAll(".pa-pagelet-tab-memory-confirm")).toHaveLength(3);
        expect(container.querySelectorAll(".pa-pagelet-tab-memory-dismiss")).toHaveLength(3);
        expect(container.querySelector(".pa-pagelet-tab-memory-confirm-all")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-digest")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-records")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-recent-changes")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-settings")).not.toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-settings--record")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-settings--change")).toBeNull();
        expect(container.querySelectorAll(".pa-pagelet-tab-tag-chip").map((chip) => chip.textContent))
            .not.toContain("Preference");
        expect(container.textContent).toContain("Your notes");
        expect(container.textContent).toContain("Your interactions with PA");
        expect(container.textContent).toContain("Source not available");
        expect(container.textContent).toContain("Current vault");
        expect(container.textContent).toContain("Can shape future answers");
        expect(container.textContent).toContain("Saved, not currently used");
        expect(container.textContent).not.toContain("current_vault");
        expect(container.textContent).not.toContain("future_answers");
        expect(container.textContent).not.toContain("stored_not_in_use");
        expect(container.textContent).not.toContain("Auto-accepted");
        expect(container.textContent).not.toContain("DURABLE RECORD MUST STAY IN SETTINGS");
        expect(container.textContent).not.toContain("RECENT CHANGE MUST STAY IN SETTINGS");
        expect(container.textContent).not.toContain("30");
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
                memorySource: "interactions",
                memoryScope: "current_vault",
                memoryEffect: "future_answers",
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
        expect(container.textContent).toContain("Suggestions to remember");
        expect(container.textContent).toContain("Prefers concise planning notes.");
        expect(container.textContent).not.toContain("No memory candidates pending");
        expect(container.textContent).not.toContain("Your interactions with PA");
        expect(container.textContent).not.toContain("Can shape future answers");

        const confirmButton = container.querySelector(".pa-pagelet-tab-memory-confirm");
        expect(confirmButton?.getAttribute("data-pa-memory-focus-key")).toBe("candidate:rq-memory:confirm");
        await confirmButton?.click();
        for (let index = 0; index < 4; index += 1) await Promise.resolve();

        expect(confirmCandidate).toHaveBeenCalledWith(candidate);
        expect(container.textContent).toContain("Confirmed");
        expect(dismissCandidate).not.toHaveBeenCalled();
        const candidateCard = container.querySelector(".pa-pagelet-tab-memory-candidate-card");
        expect(candidateCard?.getAttribute("data-pa-memory-focus-key")).toBe("candidate:rq-memory:card");
        expect((globalRecord.document as FakeDocument).activeElement).toBe(candidateCard);
        const candidateFeedback = candidateCard?.querySelector(".pa-pagelet-tab-memory-action-feedback");
        expect(candidateFeedback?.getAttribute("data-status")).toBe("confirmed");
        expect(candidateFeedback?.getAttribute("role")).toBe("status");
        expect(candidateFeedback?.getAttribute("aria-live")).toBe("polite");
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

    it("suppresses the Level 1 Memory digest for the current tab session when Later is clicked", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const candidates = [1, 2, 3].map((index) => makeReviewQueueItem({
            id: `rq-memory-${index}`,
            type: "memory_candidate",
            title: `Remember preference ${index}`,
            claim: `Preference ${index}.`,
            admissionReason: "memory_confirmation_required",
            metadata: { memoryType: "preference", sensitivity: "low" },
        }));
        const tab = new TabView("en");

        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [],
                    candidates,
                    totalCount: candidates.length,
                    confirmedMemoryCount: 10,
                },
            },
        });

        expect(container.textContent).toContain("PA learned 3 things from your recent notes.");

        await container.querySelector(".pa-pagelet-tab-memory-dismiss")?.click();

        expect(container.textContent).not.toContain("PA learned 3 things from your recent notes.");
        expect(container.textContent).toContain("Suggestions to remember");
        expect(container.textContent).toContain("Preference 1.");
    });

    it("keeps Level 2 task-constraint Memory candidates manual in the UI", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const candidate = makeReviewQueueItem({
            id: "rq-task-constraint",
            type: "memory_candidate",
            title: "Remember task constraint",
            claim: "Prefer source-backed answers.",
            admissionReason: "memory_confirmation_required",
            metadata: { memoryType: "task_constraint", sensitivity: "low" },
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
                    candidates: [candidate],
                    totalCount: 1,
                    confirmedMemoryCount: 30,
                },
            },
        });

        expect(container.textContent).not.toContain("Auto-accepted");
        expect(container.querySelector(".pa-pagelet-tab-memory-confirm")?.textContent).toBe("Confirm");
    });

    it("keeps Level 2 auto-confirm failures manual while they remain suggested", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const candidate = makeReviewQueueItem({
            id: "rq-auto-failed",
            type: "memory_candidate",
            title: "Remember preference",
            claim: "Prefers concise planning notes.",
            status: "suggested",
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
                    candidates: [candidate],
                    totalCount: 1,
                    confirmedMemoryCount: 30,
                },
            },
        });

        expect(container.textContent).toContain("Suggestions to remember");
        expect(container.textContent).toContain("Suggested");
        expect(container.textContent).not.toContain("Auto-accepted");
        expect(container.textContent).not.toContain("1 eligible Memory suggestion was accepted automatically");
        expect(container.querySelector(".pa-pagelet-tab-memory-confirm")?.textContent).toBe("Confirm");
    });

    it("points Show more aria-controls at the hidden section ids", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");
        const recallCandidate: QuietRecallCandidate = {
            id: "recall-alpha",
            title: "Recall: Alpha",
            summary: "Alpha may matter again.",
            sourceRefs: [{ path: "notes/alpha.md", evidenceStrength: "medium" }],
            whyNow: ["Source matches the note you are looking at."],
            nextAction: "Compare it.",
            relation: "related",
            score: 80,
            generatedAt: "2026-06-29T12:00:00.000Z",
        };

        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], {
            layoutType: "review",
            extra: {
                memoryGovernance: {
                    records: [makeMemoryRecord()],
                    totalCount: 1,
                },
                maintenanceReview: {
                    generatedAt: "2026-06-28T12:00:00.000Z",
                    previewOnly: true,
                    weeklyScanEnabled: false,
                    totalCount: 1,
                    categories: [{ category: "inbox_cleanup", label: "inbox_cleanup", count: 1 }],
                    proposals: [makeMaintenanceProposal()],
                },
                quietRecall: {
                    generatedAt: "2026-06-29T12:00:00.000Z",
                    currentPath: "notes/current.md",
                    totalCount: 1,
                    candidates: [recallCandidate],
                },
                graphDiscovery: {
                    generatedAt: "2026-06-29T12:00:00.000Z",
                    totalCount: 1,
                    skippedSourceCount: 0,
                    items: [{
                        id: "graph-1",
                        type: "related_note",
                        title: "Related note",
                        claim: "Related note may connect.",
                        scope: { kind: "current_note", paths: ["notes/current.md"] },
                        sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
                        whyShown: ["Shares links"],
                        edgeState: "suggested",
                        outcomeStatus: "reviewable",
                        metadata: {},
                        generatedAt: "2026-06-29T12:00:00.000Z",
                    }],
                },
            },
        });

        const showMoreButton = container.querySelector(".pa-pagelet-tab-show-more");
        const hiddenSections = container.querySelectorAll(".pa-pagelet-tab-section--hidden");
        const controlledIds = showMoreButton?.getAttribute("aria-controls")?.split(" ") ?? [];

        expect(showMoreButton).not.toBeNull();
        expect(hiddenSections.length).toBeGreaterThan(0);
        expect(controlledIds).toEqual(hiddenSections.map((section) => (
            (section as unknown as { id?: string }).id
        )));
        expect(controlledIds.every((id) => Boolean(id))).toBe(true);
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
            context: { kind: "note_retrieval" },
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
        const openSource = jest.fn((_path: string) => undefined);
        const openMemorySettings = jest.fn((_targetId?: string) => undefined);
        const tab = new TabView("en", {
            onLinkRecallCandidate: linkRecall,
            onSaveQuietRecallAsInsight: saveRecall,
            onOpenSource: openSource,
            onOpenMemorySettings: openMemorySettings,
        });
        tab.mount(tabContainer as unknown as HTMLElement);
        tab.open("Quiet Recall", [], {
            layoutType: "current",
            extra: { quietRecall },
        });

        expect(tabContainer.querySelector(".pa-pagelet-tab-quiet-recall")).not.toBeNull();
        expect(tabContainer.textContent).toContain("Why now: Source matches the note you are looking at.");
        expect(tabContainer.textContent).toContain("You could: Compare this saved insight with the current note.");
        expect(tabContainer.textContent).toContain("Source");
        expect(tabContainer.textContent).toContain("Current vault");
        expect(tabContainer.textContent).toContain("Helps relevant notes return when useful");
        expect(tabContainer.querySelector(".pa-pagelet-tab-memory-settings")).toBeNull();
        expect(tabContainer.querySelector(".pa-pagelet-tab-recall-memory-target")).toBeNull();
        expect(openMemorySettings).not.toHaveBeenCalled();
        const sourceButton = tabContainer.querySelector(".pa-pagelet-tab-recall-source");
        expect(sourceButton?.textContent).toBe("notes/current.md");
        await sourceButton?.click();
        expect(openSource).toHaveBeenCalledWith("notes/current.md");
        const linkButton = tabContainer.querySelector(".pa-pagelet-tab-recall-link");
        expect(linkButton?.textContent).toBe("Link to current note");
        expect(linkButton?.getAttribute("data-pa-recall-focus-key")).toBe("recall:qr-ins-1:link");
        const saveButton = tabContainer.querySelector(".pa-pagelet-tab-recall-save");
        expect(saveButton?.textContent).toBe("Save as insight");
        linkButton?.focus();

        await linkButton?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(linkRecall).toHaveBeenCalledWith(candidate, "notes/current.md");
        expect(tabContainer.querySelector(".pa-pagelet-tab-recall-link")?.textContent).toBe("Linked");
        expect(tabContainer.querySelector(".pa-pagelet-tab-recall-link")?.disabled).toBe(true);

        const refreshedSaveButton = tabContainer.querySelector(".pa-pagelet-tab-recall-save");
        expect((globalRecord.document as FakeDocument).activeElement).toBe(refreshedSaveButton);
        const linkedStatus = tabContainer.querySelector(".pa-pagelet-tab-maintenance-status");
        expect(linkedStatus?.getAttribute("role")).toBe("status");
        expect(linkedStatus?.getAttribute("aria-live")).toBe("polite");
        refreshedSaveButton?.focus();
        await refreshedSaveButton?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(saveRecall).toHaveBeenCalledWith(candidate);
        expect(tabContainer.textContent).toContain("Recall saved as insight.");
        expect((globalRecord.document as FakeDocument).activeElement)
            .toBe(tabContainer.querySelector(".pa-pagelet-tab-recall-card"));
    });

    it("routes a Quiet Recall Memory target only for an exact governed-claim trace", async () => {
        const candidate: QuietRecallCandidate = {
            id: "qr-governed",
            title: "Recall governed context",
            summary: "A saved understanding participated in this recall.",
            sourceRefs: [{ path: "notes/related.md", evidenceStrength: "medium" }],
            whyNow: ["It shaped this result."],
            nextAction: "Review the source and saved understanding.",
            relation: "related",
            score: 80,
            generatedAt: "2026-06-29T12:00:00.000Z",
            context: { kind: "governed_claim", claimId: "claim-exact" },
        };
        const openMemorySettings = jest.fn((_targetId?: string) => undefined);
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en", { onOpenMemorySettings: openMemorySettings });
        tab.mount(container as unknown as HTMLElement);
        tab.open("Quiet Recall", [], {
            layoutType: "current",
            extra: {
                quietRecall: {
                    generatedAt: candidate.generatedAt,
                    currentPath: "notes/current.md",
                    totalCount: 1,
                    candidates: [candidate],
                },
            },
        });

        const target = container.querySelector(".pa-pagelet-tab-recall-memory-target");
        expect(target).not.toBeNull();
        expect(target?.classList.contains("pa-pagelet-tab-memory-settings")).toBe(true);
        await target?.click();
        expect(openMemorySettings).toHaveBeenCalledWith("claim-exact");
    });

    it("keeps Quiet Recall failures localized, announced, and keyboard reachable", async () => {
        const candidate: QuietRecallCandidate = {
            id: "qr-failure",
            title: "Recall failure",
            summary: "A related note may matter.",
            sourceRefs: [{ path: "notes/related.md", evidenceStrength: "medium" }],
            whyNow: ["Related to the current note."],
            nextAction: "Compare the notes.",
            relation: "related",
            score: 80,
            generatedAt: "2026-06-29T12:00:00.000Z",
        };
        const tabContainer = new FakeElement("div");
        tabContainer.isConnected = true;
        const tab = new TabView("en", {
            onLinkRecallCandidate: jest.fn(async () => {
                throw new Error("private/internal/link-code");
            }),
            onSaveQuietRecallAsInsight: jest.fn(async () => {
                throw new Error("private/internal/save-code");
            }),
        });
        tab.mount(tabContainer as unknown as HTMLElement);
        tab.open("Quiet Recall", [], {
            layoutType: "current",
            extra: {
                quietRecall: {
                    generatedAt: candidate.generatedAt,
                    currentPath: "notes/current.md",
                    totalCount: 1,
                    candidates: [candidate],
                },
            },
        });

        const linkButton = tabContainer.querySelector(".pa-pagelet-tab-recall-link");
        linkButton?.focus();
        await linkButton?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(tabContainer.textContent).toContain("Could not link these notes. Try again.");
        expect(tabContainer.textContent).not.toContain("private/internal/link-code");
        expect((globalRecord.document as FakeDocument).activeElement)
            .toBe(tabContainer.querySelector(".pa-pagelet-tab-recall-link"));
        expect(tabContainer.querySelector(".pa-pagelet-tab-maintenance-status")?.getAttribute("role"))
            .toBe("status");

        const saveButton = tabContainer.querySelector(".pa-pagelet-tab-recall-save");
        saveButton?.focus();
        await saveButton?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(tabContainer.textContent).toContain("Could not save this recall as an insight. Try again.");
        expect(tabContainer.textContent).not.toContain("private/internal/save-code");
        expect((globalRecord.document as FakeDocument).activeElement)
            .toBe(tabContainer.querySelector(".pa-pagelet-tab-recall-save"));
        const statuses = tabContainer.querySelectorAll(".pa-pagelet-tab-maintenance-status");
        expect(statuses.every((status) => status.getAttribute("aria-live") === "polite")).toBe(true);
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
                    routedItems: [makeReviewQueueItem({
                        id: "rq-routed-memory",
                        type: "capture_enrichment",
                        status: "suggested",
                        title: "Routed memory action",
                        claim: "A routed memory-domain action should remain visible.",
                    })],
                    totalCount: 3,
                    confirmedMemoryCount: 30,
                },
                maintenanceReview: {
                    generatedAt: "2026-06-28T12:00:00.000Z",
                    previewOnly: true,
                    weeklyScanEnabled: false,
                    totalCount: 1,
                    categories: [],
                    proposals: [],
                    routedItems: [makeReviewQueueItem({
                        id: "rq-routed-maintenance",
                        type: "maintenance_proposal",
                        status: "suggested",
                        title: "Routed maintenance action",
                        claim: "A routed maintenance action should remain visible.",
                    })],
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
        expect(contentEl.textContent).toContain("Suggestions to remember");
        expect(contentEl.textContent).toContain("Suggested");
        expect(contentEl.textContent).not.toContain("Auto-accepted");
        expect(contentEl.textContent).toContain("Prefers concise planning notes.");
        expect(contentEl.textContent).toContain("A routed memory-domain action should remain visible.");
        expect(contentEl.textContent).toContain("A routed maintenance action should remain visible.");
        expect(contentEl.textContent).toContain("Prefers concise weekly planning.");
        expect(contentEl.textContent).not.toContain("Result no longer available");
    });

    it("restores a removed Memory as a text-free tombstone in the same native detail session", async () => {
        const active = makeMemoryRecord({
            confirmationStrength: "auto",
            originReviewQueueItemId: "rq-memory-origin",
        });
        const forgotten = makeMemoryRecord({
            id: active.id,
            lifecycle: "forgotten_tombstone",
            confirmationStrength: undefined,
            confirmationSource: undefined,
            originReviewQueueItemId: "rq-memory-origin",
            updatedAt: "2026-07-10T12:01:00.000Z",
            forgottenAt: "2026-07-10T12:01:00.000Z",
            tombstoneReason: "user_remove",
        });
        const onForget = jest.fn(async (_record: ConfirmedMemoryRecord) => ({
            ok: true,
            message: "Removed",
            record: forgotten,
        }));
        const view = new PageletDetailView(
            {} as never,
            () => "en",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            onForget,
        );

        await view.onOpen();
        view.setPayload({
            title: "Pagelet — Detail View",
            locale: "en",
            layoutType: "review",
            content: [],
            extra: {
                memoryGovernance: {
                    records: [active],
                    totalCount: 1,
                    confirmedMemoryCount: 30,
                },
            },
        });
        const state = view.getState();

        await (view as unknown as {
            forgetConfirmedMemory: (record: ConfirmedMemoryRecord) => Promise<{ ok: boolean; message: string }>;
        }).forgetConfirmedMemory(active);

        const restored = new PageletDetailView({} as never, () => "en");
        await restored.onOpen();
        await restored.setState(state, {} as never);

        const contentEl = restored.contentEl as unknown as FakeElement;
        expect(onForget).toHaveBeenCalledWith(active);
        expect(contentEl.textContent).toContain("Forgotten. No original content or source is kept here.");
        expect(contentEl.textContent).not.toContain("Prefers concise weekly planning.");
        expect(contentEl.textContent).not.toContain("notes/current.md");
        expect(contentEl.querySelector(".pa-pagelet-tab-memory-forget")).toBeNull();
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
        const openSource = jest.fn((_path: string) => undefined);
        const createView = (): PageletDetailView => new PageletDetailView(
            {} as never,
            () => "en",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { onOpenSource: openSource },
        );
        const view = createView();

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

        const restored = createView();
        await restored.onOpen();
        await restored.setState(serializedState, {} as never);

        const restoredContent = restored.contentEl as unknown as FakeElement;
        const text = restoredContent.textContent;
        expect(text.indexOf("A saved insight may matter now.")).toBeGreaterThanOrEqual(0);
        expect(text.indexOf("A saved insight may matter now.")).toBeLessThan(
            text.indexOf("Prefers concise weekly planning."),
        );
        expect(text).toContain("Current vault");
        expect(text).toContain("Helps relevant notes return when useful");
        await restoredContent.querySelector(".pa-pagelet-tab-recall-source")?.click();
        expect(openSource).toHaveBeenLastCalledWith("notes/current.md");

        await restored.onClose();
        await restored.onOpen();
        await restoredContent.querySelector(".pa-pagelet-tab-recall-source")?.click();
        expect(openSource).toHaveBeenCalledTimes(2);
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

    it("keeps a failed selected review visible and retryable in the panel", async () => {
        let panel: PanelView;
        const runSelected = jest.fn(async () => {
            panel.showReviewError("Pagelet review timed out. Try again, or shorten the note before retrying.");
        });
        const container = new FakeElement("div");
        container.isConnected = true;
        panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onRunSelectedReview: runSelected,
            },
            getLocale: () => "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("review", [], {
            scope: {
                range: "current",
                candidates: [{
                    path: "active.md",
                    title: "active",
                    reason: "active",
                    included: true,
                }],
                includedCount: 1,
                skippedCount: 0,
                estimatedInputTokens: 80,
            },
        });

        await container.querySelector(".pa-pagelet-panel-save-btn")?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(runSelected).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain("Review did not finish");
        expect(container.textContent).toContain("Pagelet review timed out");
        expect(container.textContent).toContain("Retry");

        await container.querySelector(".pa-pagelet-panel-error-retry")?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(runSelected).toHaveBeenCalledTimes(2);
    });

    it("updates selected review progress copy after a long provider wait", async () => {
        jest.useFakeTimers();
        try {
            const runSelected = jest.fn(async () => new Promise<void>(() => undefined));
            const container = new FakeElement("div");
            container.isConnected = true;
            const panel = new PanelView({
                app: {} as never,
                callbacks: {
                    onClose: () => undefined,
                    onExpandToTab: () => undefined,
                    onSaveAsReviewNote: async () => undefined,
                    onSourceClick: () => undefined,
                    onRunSelectedReview: runSelected,
                },
                getLocale: () => "en",
            });

            panel.mount(container as unknown as HTMLElement);
            panel.open("review", [], {
                scope: {
                    range: "current",
                    candidates: [{
                        path: "active.md",
                        title: "active",
                        reason: "active",
                        included: true,
                    }],
                    includedCount: 1,
                    skippedCount: 0,
                    estimatedInputTokens: 80,
                },
            });

            await container.querySelector(".pa-pagelet-panel-save-btn")?.click();
            expect(container.textContent).toContain("Reviewing selected notes");

            jest.advanceTimersByTime(30_000);
            await Promise.resolve();

            expect(container.textContent).toContain("Still reviewing");
            expect(container.textContent).toContain("Detailed models can take longer");
        } finally {
            jest.useRealTimers();
        }
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
