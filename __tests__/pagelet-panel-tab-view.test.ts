/* Copyright 2023 edonyzpc */

/**
 * Regression coverage for Pagelet's raw-DOM panel/tab views.
 *
 * The project does not depend on jsdom, so this file installs the tiny DOM
 * subset those bounded view classes need before importing them.
 */

import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { installObsidianDocumentHelpers } from "./helpers/obsidian-dom";
import type { SavedInsightListProps } from '../src/pagelet/ui/SavedInsightList';

const mockSavedLists: Array<{ props: SavedInsightListProps; update: jest.Mock<(props: SavedInsightListProps) => void>; notifyLayout: jest.Mock;
    rebindDocument: jest.Mock; unmount: jest.Mock }> = [];
jest.mock('../src/pagelet/ui/SavedInsightList', () => ({
    mountSavedInsightList: (_container: HTMLElement, props: SavedInsightListProps) => {
        const handle = { props, update: jest.fn((next: SavedInsightListProps) => { handle.props = next; }),
            notifyLayout: jest.fn(), rebindDocument: jest.fn(), unmount: jest.fn() };
        mockSavedLists.push(handle);
        return handle;
    },
}));

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
            (this.contentEl as FakeElement).isConnected = true;
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
    hidden = false;
    clientHeight = 220;
    scrollHeight = 2000;

    readonly ownerDocument = globalThis.document;
    contains(target: FakeElement | null): boolean {
        for (let node = target; node; node = node.parent) if (node === this) return true;
        return false;
    }
    replaceChildren(...children: FakeElement[]): void {
        for (const child of [...this.children]) this.removeChild(child);
        this.ownText = '';
        for (const child of children) this.appendChild(child);
    }

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

    insertBefore<T extends FakeElement>(child: T, reference: FakeElement): T {
        if (child.parent) child.parent.children = child.parent.children.filter(node => node !== child);
        child.parent = this;
        child.setConnected(this.isConnected);
        this.children.splice(this.children.indexOf(reference), 0, child);
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
        let top = 0;
        for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) top -= ancestor.scrollTop;
        return {
            top,
            left: 0,
            right: 360,
            bottom: top + 220,
            width: 360,
            height: 220,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        } as DOMRect;
    }

    closest(selector: string): FakeElement | null {
        let current: FakeElement | null = this;
        while (current) {
            if (this.matchesSimpleSelector(current, selector)) return current;
            current = current.parent;
        }
        return null;
    }

    querySelector(selector: string): FakeElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): FakeElement[] {
        const matches: FakeElement[] = [];
        const selectors = selector.split(",").map(part => part.trim()).filter(Boolean);
        const visit = (node: FakeElement): void => {
            if (selectors.some(part => this.matchesSimpleSelector(node, part))) matches.push(node);
            for (const child of node.children) visit(child);
        };
        visit(this);
        return matches;
    }

    private matchesSimpleSelector(node: FakeElement, selector: string): boolean {
        if (selector === "*") return true;
        if (selector.startsWith('[data-') && selector.endsWith(']')) return node.getAttribute(selector.slice(1, -1)) !== null;
        if (selector === "[data-pa-memory-focus-key]") {
            return node.getAttribute("data-pa-memory-focus-key") !== null;
        }
        if (selector === "[data-pa-recall-focus-key]") {
            return node.getAttribute("data-pa-recall-focus-key") !== null;
        }
        if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
        return node.tagName.toLowerCase() === selector.toLowerCase();
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
    private listeners = new Map<string, Set<(event: unknown) => void>>();
    readonly defaultView = { setTimeout, clearTimeout, performance,
        requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; },
        cancelAnimationFrame: () => undefined };

    constructor() {
        this.head.isConnected = true;
        this.body.isConnected = true;
        installObsidianDocumentHelpers(this);
    }

    createElement(tagName: string): FakeElement {
        const element = new FakeElement(tagName);
        Object.defineProperty(element, 'ownerDocument', { value: this });
        return element;
    }

    createElementNS(_namespace: string, tagName: string): FakeElement {
        return this.createElement(tagName);
    }

    getElementById(id: string): FakeElement | null {
        const all = [...this.head.querySelectorAll("*"), ...this.body.querySelectorAll("*")];
        return all.find((node) => node.getAttribute("id") === id) ?? null;
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }
    removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
    }
    dispatch(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
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
import type { PageletDetailReadingPayload } from "../src/pagelet/tab/types";
import type { PageletAgentDeliveryCandidate } from "../src/pagelet/agent/delivery-adapter";
import { PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS } from "../src/pagelet/agent/types";
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
    clearScopeRecapPageletDetailSessionCache,
} from "../src/pagelet/tab/PageletDetailView";

describe("Pagelet panel and tab view regressions", () => {
    function readingCandidate(id: string, bodyHash = `hash-${id}`): PageletAgentDeliveryCandidate {
        return {
            id,
            title: `Reading ${id}`,
            preparedAt: "2026-10-16T00:00:00Z",
            body: `## Full ${id}\n\nFirst paragraph.\n\n### Last section\nThe complete ending for ${id}.`,
            sourceRefs: [{ path: "notes/anchor.md", title: "Anchor" }],
            pageletAgent: {
                handoff: { id, anchor: { path: "notes/anchor.md" }, bodyHash },
            },
        } as PageletAgentDeliveryCandidate;
    }

    function readingPayload(
        overrides: Partial<PageletDetailReadingPayload> = {},
    ): PageletDetailReadingPayload {
        return {
            anchorPath: "notes/anchor.md",
            candidates: [readingCandidate("first"), readingCandidate("second")],
            selectedId: "second",
            positions: { second: { scrollTop: 371, sourcesExpanded: [true] } },
            onSelect: jest.fn(),
            onPositionChange: jest.fn(),
            validate: async () => true,
            discuss: async () => ({ status: "prepared" }),
            getReadingControls: () => ({ anchorPath: "notes/anchor.md", label: "" }),
            subscribe: () => () => undefined,
            getLatestCandidates: () => [],
            ...overrides,
        };
    }

    it("keeps empty Detail actionable without starting discovery when it opens", async () => {
        const discover = jest.fn();
        const reading = Object.assign(readingPayload({ candidates: [], selectedId: "", positions: {} }), {
            getReadingControls: () => ({
                anchorPath: "notes/anchor.md",
                label: "No content is available for this note yet. You can start a discovery.",
                actions: [{ label: "Start discovery", callback: discover }],
            }),
        });
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        expect(discover).not.toHaveBeenCalled();
        expect(content.textContent).toContain("No content is available");
        const candidates = content.querySelector(".pa-pagelet-reading-candidates");
        expect(candidates?.getAttribute("hidden")).toBe("");
        expect(content.querySelector(".pa-pagelet-reading-candidate-list")?.children).toHaveLength(0);
        const sectionPicker = content.querySelector(".pa-pagelet-reading-section-picker");
        expect(sectionPicker?.querySelector("select")?.getAttribute("hidden")).toBe("");
        const button = content.querySelector(".pa-pagelet-reading-controls")?.querySelector("button");
        expect(button?.textContent).toBe("Start discovery");
        await button?.click();
        expect(discover).toHaveBeenCalledTimes(1);
        await view.onClose();
    });

    it("keeps stale Detail text and position while disabling handoff before a click", async () => {
        let current = true;
        let update = (): void => undefined;
        const discuss = jest.fn<PageletDetailReadingPayload["discuss"]>().mockResolvedValue({ status: "prepared" });
        const reading = readingPayload({
            validate: async () => current,
            discuss,
            subscribe: listener => { update = listener; return () => undefined; },
        });
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        await Promise.resolve();
        const body = content.querySelector(".pa-pagelet-tab-body")!;
        const markdown = content.querySelector(".pa-pagelet-panel-timeline-insight");
        body.scrollTop = 512;
        current = false;
        update();
        await Promise.resolve();
        await Promise.resolve();
        expect(content.querySelector(".pa-pagelet-panel-timeline-insight")).toBe(markdown);
        expect(body.scrollTop).toBe(512);
        expect(content.textContent).toContain("out of date");
        const action = body.querySelector(".pa-pagelet-panel-timeline-action-btn");
        expect(action?.disabled).toBe(true);
        await action?.click();
        expect(discuss).not.toHaveBeenCalled();
        await view.onClose();
    });

    it("offers a refreshed version of the same insight and hides a permission-revoked reading", async () => {
        const renderPermissionHeadings = async (_app: unknown, markdown: string, target: HTMLElement) => {
            const appendTarget = target as unknown as FakeElement;
            const firstHeading = (globalThis as unknown as { document: FakeDocument }).document.createElement("h2");
            firstHeading.textContent = "First permission-checked section";
            const secondHeading = (globalThis as unknown as { document: FakeDocument }).document.createElement("h3");
            secondHeading.textContent = "Second permission-checked section";
            appendTarget.appendChild(firstHeading);
            appendTarget.appendChild(secondHeading);
            return Promise.resolve();
        };
        mockMarkdownRender.mockImplementationOnce(renderPermissionHeadings);
        mockMarkdownRender.mockImplementationOnce(renderPermissionHeadings);
        const selected = readingCandidate("selected");
        const latest = { ...selected, preparedAt: "2026-10-16T00:01:00Z" };
        let update = (): void => undefined;
        const reading = readingPayload({
            candidates: [selected], selectedId: selected.id,
            getLatestCandidates: () => [latest],
            validate: async candidate => candidate.staleStatus !== "boundary-changed",
            subscribe: listener => { update = listener; return () => undefined; },
        });
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        const sectionNavigation = content.querySelector(".pa-pagelet-reading-sections");
        const sectionSelect = content.querySelector(".pa-pagelet-reading-section-picker")
            ?.querySelector("select");
        expect(sectionNavigation?.querySelectorAll("button").map((button) => button.textContent))
            .toEqual(["First permission-checked section", "Second permission-checked section"]);
        expect(sectionSelect?.children).toHaveLength(2);
        const navigation = content.querySelector(".pa-pagelet-reading-navigation");
        const updateRegion = navigation?.querySelector(".pa-pagelet-reading-update");
        expect(updateRegion?.getAttribute("hidden")).toBeNull();
        expect(updateRegion?.querySelector("button")?.textContent).toBe("Show new results");
        await updateRegion?.querySelector("button")?.click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(reading.onSelect).toHaveBeenCalledWith(latest, [latest]);
        expect(sectionNavigation?.querySelectorAll("button").map((button) => button.textContent))
            .toEqual(["First permission-checked section", "Second permission-checked section"]);
        expect(sectionSelect?.children).toHaveLength(2);
        latest.staleStatus = "boundary-changed";
        update();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(content.textContent).not.toContain(selected.body);
        expect(content.querySelector(".pa-pagelet-reading-navigation")?.textContent).not.toContain(selected.title);
        expect(content.querySelector(".pa-pagelet-tab-body")?.textContent).not.toContain("First permission-checked section");
        expect(content.querySelector(".pa-pagelet-tab-body")?.textContent).not.toContain("Second permission-checked section");
        expect(sectionNavigation?.querySelectorAll("button")).toHaveLength(0);
        expect(sectionSelect?.children).toHaveLength(0);
        expect(sectionNavigation?.getAttribute("hidden")).toBe("");
        expect(sectionSelect?.getAttribute("hidden")).toBe("");
        await view.onClose();
    });

    it("marks an open web reading stale at its existing expiry and clears the timer on close", async () => {
        jest.useFakeTimers();
        const view = new PageletDetailView({} as never, () => "en");
        try {
            const expiresAt = Date.now() + 50;
            const candidate = readingCandidate("web");
            Object.assign(candidate.pageletAgent, { validationIdentity: {
                preparedAt: expiresAt - PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS,
                webObservations: [{ url: "https://example.com/source", observationHash: "web-source" }],
            } });
            const validate = jest.fn<PageletDetailReadingPayload["validate"]>(async () => Date.now() < expiresAt);
            const reading = readingPayload({ candidates: [candidate], selectedId: candidate.id, validate });
            const content = view.contentEl as unknown as FakeElement;
            content.isConnected = true;
            view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
            await view.onOpen();
            await Promise.resolve();
            const markdown = content.querySelector(".pa-pagelet-panel-timeline-insight");
            await jest.advanceTimersByTimeAsync(50);
            expect(validate).toHaveBeenCalledTimes(2);
            expect(content.querySelector(".pa-pagelet-panel-timeline-insight")).toBe(markdown);
            expect(content.querySelector(".pa-pagelet-panel-finding-actions")?.querySelector("button")?.disabled).toBe(true);
            await view.onClose();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            await view.onClose();
            jest.useRealTimers();
        }
    });

    it("preserves Panel reading DOM and position when the same content receives activity updates", async () => {
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
        const candidate = readingCandidate("selected");
        const finding = { title: candidate.title, description: candidate.body,
            insightText: candidate.body, sourceFile: "notes/anchor.md" };
        panel.mount(container as unknown as HTMLElement);
        panel.open("discover", [finding], {
            entityId: candidate.id,
            sourcePath: "notes/anchor.md",
            reading: { anchorPath: "notes/anchor.md", label: "Analyzing" },
        });
        await Promise.resolve();
        const body = container.querySelector(".pa-pagelet-panel-body");
        const markdown = container.querySelector(".pa-pagelet-panel-timeline-insight");
        const sourceToggle = container.querySelector(".pa-pagelet-panel-source-toggle");
        await sourceToggle?.click();
        if (body) body.scrollTop = 487;
        panel.open("discover", [{ ...finding, actionStatus: { label: "Ready to discuss" } }], {
            entityId: candidate.id,
            sourcePath: "notes/anchor.md",
            reading: { anchorPath: "notes/anchor.md", label: "New results are available" },
        });
        expect(container.querySelector(".pa-pagelet-panel-timeline-insight")).toBe(markdown);
        expect(container.querySelector(".pa-pagelet-panel-source-toggle")).toBe(sourceToggle);
        expect(panel.getReadingPosition()).toMatchObject({ scrollTop: 487, sourcesExpanded: [true] });
        expect(container.textContent).toContain("New results are available");
        expect(container.textContent).toContain("Ready to discuss");
        expect(mockMarkdownRender).toHaveBeenCalledTimes(1);
        (globalRecord.document as FakeDocument).dispatch('pointerdown', { target: markdown });
        const updateBody = (text: string, entityId = candidate.id) => panel.open('discover', [{
            ...finding, description: text, insightText: text,
        }], { entityId, sourcePath: 'notes/anchor.md' });
        updateBody('An intermediate update.');
        updateBody('The latest complete update.');
        expect(container.querySelector('.pa-pagelet-panel-timeline-insight')).toBe(markdown);
        expect(markdown?.textContent).toBe(candidate.body);
        expect(container.querySelector('.pa-pagelet-native-update')?.hidden).toBe(false);
        await container.querySelector('.pa-pagelet-native-show-latest')?.click();
        expect(markdown?.textContent).toBe('The latest complete update.');
        expect(mockMarkdownRender).toHaveBeenCalledTimes(2);
        updateBody('A different entity.', 'replacement');
        await Promise.resolve();
        expect(container.querySelector('.pa-pagelet-panel-timeline-insight')).not.toBe(markdown);
        expect(container.querySelector('.pa-pagelet-panel-timeline-insight')?.textContent).toBe('A different entity.');
        panel.destroy();
    });

    it('captures expanded Sources without a scroll event before the Panel close callback reads its position', async () => {
        const container = new FakeElement('div');
        container.isConnected = true;
        let closedPosition: ReturnType<PanelView['getReadingPosition']> | undefined;
        const panel: PanelView = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => { closedPosition = panel.getReadingPosition(); },
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
            },
            getLocale: () => 'en',
        });
        const candidate = readingCandidate('close-disclosure');
        panel.mount(container as unknown as HTMLElement);
        panel.open('discover', [{ title: candidate.title, description: candidate.body,
            insightText: candidate.body, sourceFile: 'notes/anchor.md' }], {
            entityId: candidate.id, sourcePath: 'notes/anchor.md',
        });
        await Promise.resolve();
        await container.querySelector('.pa-pagelet-panel-source-toggle')?.click();
        panel.close();
        expect(closedPosition).toMatchObject({ scrollTop: 0, sourcesExpanded: [true], disclosures: ['sources'] });
        panel.destroy();
    });

    it("restores Panel position after Markdown layout and isolates a late renderer from a reopened reading", async () => {
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
        const candidate = readingCandidate("selected");
        const openDeferred = (scrollTop: number): (() => void) => {
            let finish!: () => void;
            mockMarkdownRender.mockImplementationOnce((_app, markdown, target) => {
                const body = container.querySelector(".pa-pagelet-panel-body")!;
                let ready = false;
                let actualScrollTop = 0;
                Object.defineProperty(body, "scrollTop", {
                    configurable: true,
                    get: () => actualScrollTop,
                    set: (value: number) => { actualScrollTop = ready ? value : 0; },
                });
                return new Promise<void>((resolve) => {
                    finish = () => { ready = true; target.textContent = markdown; resolve(); };
                });
            });
            panel.open("discover", [{ title: candidate.title, description: candidate.body,
                insightText: candidate.body, sourceFile: "notes/anchor.md" }], {
                sourcePath: "notes/anchor.md",
                reading: { anchorPath: "notes/anchor.md", label: "" },
            });
            panel.restoreReadingPosition({ scrollTop, sourcesExpanded: [true] });
            return () => finish();
        };
        const finishFirst = openDeferred(371);
        expect(container.querySelector('.pa-pagelet-panel-body')?.scrollTop).toBe(0);
        finishFirst();
        await Promise.resolve();
        await Promise.resolve();
        expect(panel.getReadingPosition()).toMatchObject({ scrollTop: 371, sourcesExpanded: [true] });

        panel.close();
        const finishOld = openDeferred(412);
        panel.close();
        const finishCurrent = openDeferred(219);
        finishOld();
        await Promise.resolve();
        await Promise.resolve();
        expect(container.querySelector('.pa-pagelet-panel-body')?.scrollTop).toBe(0);
        finishCurrent();
        await Promise.resolve();
        await Promise.resolve();
        expect(panel.getReadingPosition()).toMatchObject({ scrollTop: 219, sourcesExpanded: [true] });
        expect(container.querySelector(".pa-pagelet-panel-timeline-insight")?.textContent).toBe(candidate.body);
        panel.destroy();
    });

    it("carries selected full reading, anchor, order and position into Detail", async () => {
        const reading = readingPayload();
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        await Promise.resolve();
        expect(reading.onSelect).toHaveBeenCalledWith(reading.candidates[1]);

        const body = content.querySelector(".pa-pagelet-tab-body");
        expect(body?.textContent).toContain(reading.candidates[1]!.body);
        expect(content.textContent).toContain("notes/anchor.md");
        expect(body?.scrollTop).toBe(371);
        expect(body?.querySelector(".pa-pagelet-panel-source-toggle")?.getAttribute("aria-expanded"))
            .toBe("true");
        const navigation = content.querySelector(".pa-pagelet-reading-navigation");
        const buttons = navigation?.querySelectorAll("button") ?? [];
        expect(buttons.map((button) => button.textContent)).toEqual(["Reading first", "Reading second"]);
        await buttons[0]?.click();
        await Promise.resolve();
        expect(reading.onSelect).toHaveBeenCalledWith(reading.candidates[0]);
        expect(body?.textContent).toContain(reading.candidates[0]!.body);
        const state = view.getState();
        expect(JSON.stringify(state)).not.toContain("Full second");
        if (body) body.scrollTop = 219;
        await view.onClose();
        const restored = new PageletDetailView({} as never, () => "en");
        const restoredContent = restored.contentEl as unknown as FakeElement;
        restoredContent.isConnected = true;
        await restored.setState(state, {} as never);
        await restored.onOpen();
        expect(restoredContent.querySelector(".pa-pagelet-tab-body")?.scrollTop).toBe(219);
        expect(restoredContent.textContent).toContain(reading.candidates[0]!.body);
        await restored.onClose();
    });

    it("renders the reading hierarchy, candidate selection and rendered-section positioning", async () => {
        mockMarkdownRender.mockImplementationOnce(async (_app, markdown, target) => {
            target.textContent = "";
            const appendTarget = target as unknown as FakeElement;
            const title = (globalThis as unknown as { document: FakeDocument }).document.createElement("h2");
            title.textContent = "First h2";
            const interleaved = (globalThis as unknown as { document: FakeDocument }).document.createElement("h3");
            interleaved.textContent = "Interleaved h3";
            const ending = (globalThis as unknown as { document: FakeDocument }).document.createElement("h2");
            ending.textContent = "Second h2";
            appendTarget.appendChild(title);
            appendTarget.appendChild(interleaved);
            appendTarget.appendChild(ending);
            return Promise.resolve();
        });
        const reading = readingPayload();
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        const root = content.querySelector(".pa-pagelet-tab");
        expect(root?.classList.contains("pa-pagelet-tab--reading")).toBe(true);
        const navigation = content.querySelector(".pa-pagelet-reading-navigation");
        expect(navigation?.textContent).toContain("Reading");
        expect(navigation?.textContent).toContain("notes/anchor.md");
        expect(navigation?.textContent).toContain("Reading 2 of 2");
        const candidateButtons = navigation
            ?.querySelector(".pa-pagelet-reading-candidate-list")
            ?.querySelectorAll("button") ?? [];
        expect(candidateButtons.map((button) => button.textContent)).toEqual(["Reading first", "Reading second"]);
        expect(candidateButtons[1]?.getAttribute("aria-pressed")).toBe("true");
        const candidateSelect = navigation?.querySelector("select");
        expect(candidateSelect?.value).toBe("second");
        expect(content.querySelector(".pa-pagelet-tab-body")?.querySelectorAll("h2, h3").map((heading) => heading.textContent))
            .toEqual(["First h2", "Interleaved h3", "Second h2"]);
        const sectionButtons = navigation
            ?.querySelector(".pa-pagelet-reading-sections")
            ?.querySelectorAll("button") ?? [];
        expect(sectionButtons.map((button) => button.textContent))
            .toEqual(["First h2", "Interleaved h3", "Second h2"]);
        expect(sectionButtons[0]?.getAttribute("aria-current")).toBe("true");
        expect(navigation?.querySelectorAll("select")[1]?.getAttribute("aria-label"))
            .toBe("Sections on this page");
        await view.onClose();
    });

    it("hydrates an empty waiting reading without rebuilding an occupied reading", async () => {
        let update = (): void => undefined;
        const candidate = readingCandidate("waiting-result");
        const reading = readingPayload({
            candidates: [], selectedId: "", positions: {},
            subscribe: listener => { update = listener; return () => undefined; },
        });
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        let displayed = false;
        (view as unknown as { containerEl: { isShown: () => boolean } }).containerEl = {
            isShown: () => displayed,
        };
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        expect(content.textContent).not.toContain(candidate.body);

        reading.candidates = [candidate];
        reading.selectedId = candidate.id;
        update();
        await Promise.resolve();
        expect(content.querySelector(".pa-pagelet-tab-body")?.textContent).not.toContain(candidate.body);
        expect(reading.onSelect).not.toHaveBeenCalled();
        const hydrated = content.querySelector(".pa-pagelet-panel-timeline-insight");
        update();
        expect(content.querySelector(".pa-pagelet-panel-timeline-insight")).toBe(hydrated);
        displayed = true;
        view.notifyDisplayed();
        await Promise.resolve();
        expect(content.querySelector('.pa-pagelet-tab-body')?.textContent).toContain(candidate.body);
        expect(reading.onSelect).toHaveBeenCalledWith(candidate);
        await view.onClose();
    });

    it("reveals only the exact live reading and reuses an already selected candidate", async () => {
        const first = readingCandidate("first");
        const second = readingCandidate("second");
        const validate = jest.fn<PageletDetailReadingPayload["validate"]>(async candidate => (
            candidate.staleStatus !== "boundary-changed"
        ));
        const reading = readingPayload({
            candidates: [first, second],
            selectedId: second.id,
            positions: {
                first: { scrollTop: 91, sourcesExpanded: [false] },
                second: { scrollTop: 371, sourcesExpanded: [true] },
            },
            validate,
        });
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        await Promise.resolve();
        await Promise.resolve();
        const initialSelectCount = (reading.onSelect as jest.Mock).mock.calls.length;
        const selectedBody = content.querySelector(".pa-pagelet-panel-timeline-insight");

        expect(view.hasLivePageletReading({
            anchorPath: "notes/anchor.md", candidateId: second.id, bodyHash: "hash-second",
        })).toBe(true);
        await expect(view.revealPageletReading({
            anchorPath: "notes/anchor.md", candidateId: second.id, bodyHash: "hash-second",
        })).resolves.toBe(true);
        expect(content.querySelector(".pa-pagelet-panel-timeline-insight")).toBe(selectedBody);
        expect(reading.onSelect).toHaveBeenCalledTimes(initialSelectCount);

        await expect(view.revealPageletReading({
            anchorPath: "notes/anchor.md", candidateId: first.id, bodyHash: "hash-first",
        })).resolves.toBe(true);
        expect(reading.onSelect).toHaveBeenCalledWith(first);
        expect(content.querySelector(".pa-pagelet-tab-body")?.scrollTop).toBe(91);
        const selectCountAfterFirst = (reading.onSelect as jest.Mock).mock.calls.length;
        const displayedBody = content.querySelector(".pa-pagelet-panel-timeline-insight");
        const displayedBodyText = displayedBody?.textContent ?? "";
        const tabBody = content.querySelector(".pa-pagelet-tab-body");
        const displayedScrollTop = tabBody?.scrollTop ?? 0;

        await expect(view.revealPageletReading({
            anchorPath: "notes/anchor.md", candidateId: first.id, bodyHash: "wrong-hash",
        })).resolves.toBe(false);
        await expect(view.revealPageletReading({
            anchorPath: "notes/anchor.md", candidateId: "missing-candidate", bodyHash: "hash-first",
        })).resolves.toBe(false);
        await expect(view.revealPageletReading({
            anchorPath: "notes/wrong-anchor.md", candidateId: first.id, bodyHash: "hash-first",
        })).resolves.toBe(false);
        expect(reading.onSelect).toHaveBeenCalledTimes(selectCountAfterFirst);
        expect(content.querySelector(".pa-pagelet-panel-timeline-insight")).toBe(displayedBody);
        expect(content.querySelector(".pa-pagelet-tab-body")).toBe(tabBody);
        expect(displayedBody?.textContent).toBe(displayedBodyText);
        expect(tabBody?.scrollTop).toBe(displayedScrollTop);
        first.staleStatus = "boundary-changed";
        expect(view.hasLivePageletReading({
            anchorPath: "notes/anchor.md", candidateId: first.id, bodyHash: "hash-first",
        })).toBe(false);
        await expect(view.revealPageletReading({
            anchorPath: "notes/anchor.md", candidateId: first.id, bodyHash: "hash-first",
        })).resolves.toBe(false);
        expect(reading.onSelect).toHaveBeenCalledTimes(initialSelectCount + 1);
        await view.onClose();
    });

    it("captures reading source disclosure changes before a hidden zero-layout hide and restore", async () => {
        const candidate = readingCandidate("source-disclosure");
        const reading = readingPayload({
            candidates: [candidate],
            selectedId: candidate.id,
            positions: { [candidate.id]: { scrollTop: 123, sourcesExpanded: [false] } },
        });
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");
        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], { reading });
        const body = container.querySelector(".pa-pagelet-tab-body")!;
        const portRect = body.getBoundingClientRect();
        let hidden = false;
        body.getBoundingClientRect = () => hidden
            ? { ...portRect, width: 0, height: 0, bottom: 0 } as DOMRect
            : portRect;
        const toggle = container.querySelector(".pa-pagelet-panel-source-toggle")!;
        const chips = () => container.querySelector(".pa-pagelet-panel-source-chips")!;

        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await toggle.click();
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(chips().getAttribute("hidden")).toBeNull();

        hidden = true;
        tab.setDisplayed(false);
        hidden = false;
        tab.setDisplayed(true);
        expect(body.scrollTop).toBe(123);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(chips().getAttribute("hidden")).toBeNull();

        await toggle.click();
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(chips().getAttribute("hidden")).toBe("");

        hidden = true;
        tab.setDisplayed(false);
        hidden = false;
        tab.setDisplayed(true);
        expect(body.scrollTop).toBe(123);
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(chips().getAttribute("hidden")).toBe("");
        tab.destroy();
    });

    it("updates Detail activity without rebuilding reading, and disposes its subscription", async () => {
        let label = "Analyzing";
        let update = (): void => undefined;
        const unsubscribe = jest.fn();
        const reading = readingPayload({
            getReadingControls: () => ({ anchorPath: "notes/anchor.md", label }),
            subscribe: (listener) => { update = listener; return unsubscribe; },
        });
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        const body = content.querySelector(".pa-pagelet-tab-body");
        const markdown = content.querySelector(".pa-pagelet-panel-timeline-insight");
        if (body) body.scrollTop = 512;
        label = "New discoveries are available";
        update();
        expect(content.querySelector(".pa-pagelet-panel-timeline-insight")).toBe(markdown);
        expect(body?.scrollTop).toBe(512);
        const navigation = content.querySelector(".pa-pagelet-reading-navigation")?.querySelectorAll("button")[0];
        update();
        expect(content.querySelector(".pa-pagelet-reading-navigation")?.querySelectorAll("button")[0])
            .toBe(navigation);
        expect(content.querySelector(".pa-pagelet-panel-source-toggle")?.getAttribute("aria-expanded"))
            .toBe("true");
        expect(content.textContent).toContain(label);
        await view.onClose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        update();
        expect(content.querySelector(".pa-pagelet-tab")).toBeNull();
    });

    it("restores position after asynchronous Markdown layout without applying late work to replacement reading", async () => {
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        const deferredRender = (): (() => void) => {
            let finish!: () => void;
            mockMarkdownRender.mockImplementationOnce((_app, markdown, target) => {
                const body = content.querySelector(".pa-pagelet-tab-body")!;
                let ready = false;
                let scrollTop = 0;
                Object.defineProperty(body, "scrollTop", {
                    configurable: true,
                    get: () => scrollTop,
                    set: (value: number) => { scrollTop = ready ? value : 0; },
                });
                return new Promise<void>((resolve) => {
                    finish = () => {
                        ready = true;
                        target.textContent = markdown;
                        resolve();
                    };
                });
            });
            return () => finish();
        };
        const finishFirst = deferredRender();
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading: readingPayload() });
        await view.onOpen();
        expect(content.querySelector(".pa-pagelet-tab-body")?.scrollTop).toBe(0);
        finishFirst();
        await Promise.resolve();
        await Promise.resolve();
        expect(content.querySelector(".pa-pagelet-tab-body")?.scrollTop).toBe(371);

        const finishLate = deferredRender();
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading: readingPayload() });
        const replacement = readingPayload({
            selectedId: "first", positions: { first: { scrollTop: 219, sourcesExpanded: [false] } },
        });
        // The replacement has laid out while the old renderer is still pending.
        const body = content.querySelector(".pa-pagelet-tab-body")!;
        Object.defineProperty(body, "scrollTop", { configurable: true, writable: true, value: 0 });
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading: replacement });
        finishLate();
        await Promise.resolve();
        await Promise.resolve();
        expect(body.scrollTop).toBe(219);
        expect(body.textContent).toContain(replacement.candidates[0]!.body);
        await view.onClose();
    });

    it.each(["close", "select another"] as const)("cancels a pending Detail handoff on %s", async (actionKind) => {
        let finishValidation!: (valid: boolean) => void;
        let validationSignal: AbortSignal | undefined;
        let validationCalls = 0;
        const discuss = jest.fn< PageletDetailReadingPayload["discuss"] >()
            .mockResolvedValue({ status: "prepared" });
        const reading = readingPayload({
            validate: (_candidate, signal) => {
                validationCalls += 1;
                if (validationCalls === 1 || _candidate.id === "first") return Promise.resolve(true);
                validationSignal = signal;
                return new Promise((resolve) => { finishValidation = resolve; });
            },
            discuss,
        });
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        const action = content.querySelector(".pa-pagelet-panel-timeline-action-btn");
        expect(action?.textContent).toBe("Discuss in Chat");
        const pending = action?.click();
        await Promise.resolve();
        if (actionKind === "close") await view.onClose();
        else {
            await content.querySelector(".pa-pagelet-reading-navigation")?.querySelectorAll("button")[0]?.click();
            await Promise.resolve();
        }
        expect(validationSignal?.aborted).toBe(true);
        finishValidation(true);
        await pending;
        expect(discuss).not.toHaveBeenCalled();
        await view.onClose();
    });

    it("hands the selected full reading to Chat independently and preserves it on preparation failure", async () => {
        const discuss = jest.fn<PageletDetailReadingPayload["discuss"]>()
            .mockResolvedValueOnce({ status: "busy" })
            .mockResolvedValueOnce({ status: "prepared" });
        const reading = readingPayload({ discuss });
        const view = new PageletDetailView({} as never, () => "en");
        const content = view.contentEl as unknown as FakeElement;
        content.isConnected = true;
        view.setPayload({ title: "Pagelet", content: [], locale: "en", reading });
        await view.onOpen();
        const markdown = content.querySelector(".pa-pagelet-panel-timeline-insight");
        const action = content.querySelector(".pa-pagelet-panel-timeline-action-btn");
        await action?.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(discuss).toHaveBeenCalledWith(reading.candidates[1], expect.any(AbortSignal));
        expect(content.textContent).toContain("Chat is busy");
        expect(content.querySelector(".pa-pagelet-panel-timeline-insight")).toBe(markdown);
        await action?.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(discuss).toHaveBeenCalledTimes(2);
        expect(content.querySelector(".pa-pagelet-panel-timeline-insight")).toBe(markdown);
        await view.onClose();
    });
    beforeEach(() => {
        globalRecord.document = new FakeDocument();
        globalRecord.confirm = originalConfirm;
        clearPageletDetailSessionCache();
        mockMarkdownRender.mockClear();
        mockSavedLists.length = 0;
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
        const { addIcon: addIconMock } = jest.requireMock("obsidian") as { addIcon: jest.Mock };
        addIconMock.mockClear();
        const view = new PageletDetailView({} as never, () => "en");
        const updateHeader = jest.fn();
        (view as unknown as { leaf: { updateHeader: typeof updateHeader } }).leaf = { updateHeader };
        (view as unknown as { app: unknown }).app = {
            workspace: { getLeavesOfType: () => [] },
        };

        expect(view.getViewType()).toBe(PAGELET_DETAIL_VIEW_TYPE);
        expect(view.getIcon()).toBe(PAGELET_DETAIL_ICON);
        expect(addIconMock).toHaveBeenCalledWith(view.getIcon(), expect.any(String));
        const svg = addIconMock.mock.calls.find(([name]) => name === view.getIcon())?.[1];
        expect(svg).toMatch(/^<svg\b[^>]*>[\s\S]+<\/svg>$/);
        expect(svg).toMatch(/<(?:path|circle|rect|ellipse|line|polyline|polygon)\b/);

        await view.onOpen();
        updateHeader.mockClear();
        view.setPayload({
            title: "Pagelet — Detail View",
            content: [],
            locale: "en",
            sourcePath: "notes/current.md",
        });
        expect(updateHeader).toHaveBeenCalledWith();

        expect(view.getDisplayText()).toBe("Pagelet — current");
        view.setHasNewResults(true);
        expect(updateHeader).toHaveBeenCalledTimes(2);
        expect(view.getDisplayText()).toContain("New");
        const contentEl = view.contentEl as unknown as FakeElement;
        expect(contentEl.textContent).toContain("No findings yet");
        expect(contentEl.querySelector(".pa-pagelet-tab-header")).toBeNull();
    });

    it("notifies the host once when a note Detail closes", async () => {
        const closed: string[] = [];
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
            {},
            closedView => {
                closed.push(closedView.getNoteAnchorPath() ?? "none");
            },
        );
        await view.onOpen();
        view.setPayload({
            title: "Pagelet",
            content: [],
            locale: "en",
            sourcePath: "notes/current.md",
        });
        await view.onClose();
        expect(closed).toEqual(["notes/current.md"]);
    });

    it("opens related notes through a navigable leaf without replacing the current Detail", async () => {
        const relatedFile = { extension: "md" };
        const editorLeaf = { openFile: jest.fn(async (_file: unknown) => undefined) };
        const currentDetailLeaf = { openFile: jest.fn(async () => undefined) };
        const view = new PageletDetailView({} as never, () => "en");
        (view as unknown as { app: unknown }).app = {
            workspace: {
                getLeaf: jest.fn(() => editorLeaf),
                getMostRecentLeaf: jest.fn(() => currentDetailLeaf),
            },
            vault: {
                getAbstractFileByPath: jest.fn(() => relatedFile),
            },
            metadataCache: {
                getFirstLinkpathDest: jest.fn(() => null),
            },
        };
        await view.onOpen();
        view.setPayload({
            title: "Pagelet",
            content: [],
            locale: "en",
            layoutType: "discover",
            sourcePath: "notes/current.md",
            extra: {
                connections: [{
                    fromNote: "notes/current.md",
                    toNote: "notes/related.md",
                    strength: "medium" as const,
                    sharedConcepts: ["shared constraint"],
                }],
            },
        });
        const content = view.contentEl as unknown as FakeElement;
        const node = content.querySelectorAll(".pa-pagelet-panel-connection-node")[1];
        await node?.click();

        expect((view as unknown as { app: { workspace: { getLeaf: jest.Mock } } }).app.workspace.getLeaf)
            .toHaveBeenCalledWith(false);
        expect(editorLeaf.openFile).toHaveBeenCalledWith(relatedFile);
        expect(currentDetailLeaf.openFile).not.toHaveBeenCalled();
        expect(view.getNoteAnchorPath()).toBe("notes/current.md");
        await view.onClose();
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
        await Promise.resolve();

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

    it("renders structured insight and comparison cards with their visual modifier classes", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");

        tab.mount(container as unknown as HTMLElement);
        tab.open("Scope Recap", [{
            title: "Observations",
            cards: [
                {
                    title: "Shared theme",
                    body: "Trust is becoming a shared constraint.",
                    cardStyle: "insight",
                },
                {
                    title: "Product tension",
                    body: "Immediate value and quiet preparation pull in different directions.",
                    cardStyle: "comparison",
                },
            ],
        }]);

        expect(container.querySelector(".pa-pagelet-tab-card--insight")).not.toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-card--comparison")).not.toBeNull();
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
        expect(mockSavedLists.at(-1)?.props.items).toEqual([makeSavedInsight()]);
        expect(container.textContent).toContain("Memory");
        expect(container.textContent).toContain("Prefers concise weekly planning.");
        expect(container.textContent).toContain("Forgotten. No original content or source is kept here.");
        expect(container.textContent).not.toContain("No findings yet");
    });

    it("maps current and clicked Detail sections through their real aliases", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");
        const quietCandidate: QuietRecallCandidate = {
            id: "qr-current-section",
            title: "Recall: current section",
            summary: "A saved insight may matter now.",
            sourceInsightId: "ins-current-section",
            sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
            whyNow: ["Source matches the note you are looking at."],
            nextAction: "Compare this saved insight with the current note.",
            relation: "current",
            score: 90,
            generatedAt: "2026-06-29T12:00:00.000Z",
            context: { kind: "note_retrieval" },
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-current-section",
        };
        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [], {
            layoutType: "review",
            entryReason: "quiet-recall",
            extra: {
                quietRecall: {
                    generatedAt: "2026-06-29T12:00:00.000Z",
                    currentPath: "notes/current.md",
                    totalCount: 1,
                    candidates: [quietCandidate],
                },
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
            },
        });

        const body = container.querySelector(".pa-pagelet-tab-body");
        const sections = [
            container.querySelector(".pa-pagelet-tab-quiet-recall"),
            container.querySelector(".pa-pagelet-tab-memory-governance"),
            container.querySelector(".pa-pagelet-tab-maintenance-review"),
        ];
        const tops = [-160, -20, 140];
        const scrolledIntoView = sections.map(() => jest.fn());
        sections.forEach((section, index) => {
            if (section) {
                Object.defineProperty(section, "getBoundingClientRect", {
                    value: () => ({ top: tops[index] }),
                });
                Object.defineProperty(section, "scrollIntoView", {
                    value: scrolledIntoView[index],
                });
            }
        });
        await body?.dispatch("scroll");

        const buttons = container.querySelector(".pa-pagelet-tab-nav")?.querySelectorAll("button") ?? [];
        expect(buttons.map((button) => button.textContent)).toEqual([
            "Quiet Recall",
            "Memory",
            "Maintenance Review",
        ]);
        expect(buttons.map((button) => button.getAttribute("aria-current"))).toEqual([
            null,
            "true",
            null,
        ]);
        await buttons[1]?.click();
        expect(scrolledIntoView[1]).toHaveBeenCalled();
        expect(scrolledIntoView[2]).not.toHaveBeenCalled();
        tab.destroy();
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
        expect(container.textContent).toContain(new Intl.DateTimeFormat("en", {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(new Date("2026-06-28T12:00:00.000Z")));
        expect(container.textContent).not.toContain("2026-06-28 12:00");
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

    it('shows the complete style sample and routes correction to the existing Memory settings editor', async () => {
        const container = new FakeElement('div'); container.isConnected = true;
        const onCorrect = jest.fn(async () => ({ ok: true, message: 'corrected' }));
        const onOpenMemorySettings = jest.fn();
        const record = { ...makeMemoryRecord(), effect: 'future_answers' as const, useStatus: 'active' as const,
            actionPolicy: { correct: true, pause: true, resume: true, forget: true },
            writingStyle: { exactText: '  完整样例\n不会被摘要替代。', writingVersionId: 'v1',
                scene: { writingTask: 'copywriting', purpose: 'social_share', audience: 'friends', domain: 'travel' } } };
        const tab = new TabView('en', { onCorrect, onOpenMemorySettings });
        tab.mount(container as unknown as HTMLElement);
        tab.open('Memory', [], { layoutType: 'review', extra: { memoryGovernance: { records: [record], totalCount: 1 } } });
        expect(container.querySelector('textarea')?.value).toBe(record.writingStyle.exactText);
        await container.querySelector('.pa-pagelet-tab-memory-correct')?.click();
        expect(onOpenMemorySettings).toHaveBeenCalledWith(record.id); expect(onCorrect).not.toHaveBeenCalled();
        expect(container.querySelector('.pa-pagelet-tab-memory-correction-save')).toBeNull();
        tab.destroy();
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
        expect(container.textContent).toContain("Understanding used for this result");
        expect(container.querySelector(".pa-pagelet-tab-memory-candidates")).toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-memory-candidates-empty")).toBeNull();
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

    it("does not present contextual candidates as understanding used by the result", async () => {
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
        expect(content.textContent).not.toContain("Prefers short weekly plans.");
        expect(content.querySelector(".pa-pagelet-tab-memory-candidates")).toBeNull();
        expect(content.querySelector(".pa-pagelet-tab-memory-candidates-empty")).toBeNull();
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

    it("reveals Saved Insights in place and retains its connected root across same-surface updates", async () => {
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
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-recall-alpha",
        };

        tab.mount(container as unknown as HTMLElement);
        const options: Parameters<TabView['open']>[2] = {
            layoutType: "review",
            extra: {
                savedInsights: { items: [makeSavedInsight()], totalCount: 1 },
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
        };
        tab.open("Pagelet — Detail View", [], options);

        const showMoreButton = container.querySelector(".pa-pagelet-tab-show-more");
        const hiddenSections = container.querySelectorAll(".pa-pagelet-tab-section--hidden");
        const controlledIds = showMoreButton?.getAttribute("aria-controls")?.split(" ") ?? [];

        expect(showMoreButton).not.toBeNull();
        expect(hiddenSections.length).toBeGreaterThan(0);
        expect(controlledIds).toEqual(hiddenSections.map((section) => (
            (section as unknown as { id?: string }).id
        )));
        expect(controlledIds.every((id) => Boolean(id))).toBe(true);
        const savedSection = container.querySelector('.pa-pagelet-tab-saved-insights')!;
        expect(savedSection.classList.contains('pa-pagelet-tab-section--hidden')).toBe(true);
        expect(mockSavedLists).toHaveLength(0);
        await showMoreButton?.click();
        expect(mockSavedLists).toHaveLength(1);
        const list = mockSavedLists[0];
        const disconnections: boolean[] = [];
        let connected = savedSection.isConnected;
        Object.defineProperty(savedSection, 'isConnected', {
            get: () => connected,
            set: (value: boolean) => { connected = value; if (!value) disconnections.push(value); },
        });
        const updated = makeSavedInsight({ id: 'updated', text: 'Latest complete saved text.' });
        tab.open('Pagelet — Detail View', [], { ...options,
            extra: { ...options.extra, savedInsights: { items: [updated], totalCount: 1 } } });
        expect(container.querySelector('.pa-pagelet-tab-saved-insights')).toBe(savedSection);
        expect(disconnections).toEqual([]);
        expect(mockSavedLists).toHaveLength(1);
        expect(list.props.items).toEqual([updated]);
        expect(savedSection.classList.contains('pa-pagelet-tab-section--hidden')).toBe(false);
        const sections = container.querySelectorAll('.pa-pagelet-tab-section');
        expect(sections.at(-1)).toBe(savedSection);
        tab.setDisplayed(false);
        expect(list.props.store.getState().viewVisible).toBe(false);
        tab.setDisplayed(true);
        tab.rebindDocument();
        expect(list.rebindDocument).toHaveBeenCalledTimes(1);
        expect(list.unmount).not.toHaveBeenCalled();
        tab.open('Pagelet — Detail View', [], { layoutType: 'review' });
        expect(list.unmount).toHaveBeenCalledTimes(1);
        tab.destroy();
    });

    it('captures the Saved row committed after scroll before restoring its relative position on reveal', async () => {
        const container = new FakeElement('div');
        container.isConnected = true;
        const tab = new TabView('en');
        const insight = makeSavedInsight({ id: 'after-scroll' });
        tab.mount(container as unknown as HTMLElement);
        tab.open('Saved Insights', [], { layoutType: 'review',
            extra: { savedInsights: { items: [insight], totalCount: 1 } } });
        const list = mockSavedLists[0];
        const port = container.querySelector('.pa-pagelet-tab-body')!;
        const portRect = port.getBoundingClientRect();
        let hidden = false;
        port.getBoundingClientRect = () => hidden
            ? { ...portRect, width: 0, height: 0, bottom: 0 } as DOMRect : portRect;

        // The real scroll handler runs before React commits its new virtual range.
        port.scrollTop = 600;
        await port.dispatch('scroll');
        const row = (globalRecord.document as FakeDocument).createElement('div');
        row.setAttribute('data-pa-reading-id', `saved-insight:${insight.id}`);
        let rowLayoutTop = 580;
        row.getBoundingClientRect = () => ({ ...portRect,
            top: rowLayoutTop - port.scrollTop, bottom: rowLayoutTop - port.scrollTop + 120,
            height: hidden ? 0 : 120, width: hidden ? 0 : 360,
        } as DOMRect);
        container.querySelector('.pa-pagelet-tab-saved-insights')!.children[2].appendChild(row);
        list.props.onLayout();

        // Obsidian reports visibility after layout is already zero, so hiding
        // cannot repair a snapshot that was never sampled after the row commit.
        hidden = true;
        tab.setDisplayed(false);
        rowLayoutTop += 300;
        hidden = false;
        tab.setDisplayed(true);
        expect(port.scrollTop).toBe(900);
        expect(row.getBoundingClientRect().top).toBe(-20);
        tab.destroy();
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
            sourceRefs: [
                { path: "notes/current.md", evidenceStrength: "medium" },
                { path: "notes/related.md", evidenceStrength: "medium" },
            ],
            whyNow: ["Source matches the note you are looking at."],
            nextAction: "Compare this saved insight with the current note.",
            relation: "current",
            score: 90,
            generatedAt: "2026-06-29T12:00:00.000Z",
            context: { kind: "note_retrieval" },
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-ins-1",
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

    it("hides Quiet Recall Link when the candidate has no distinct source note", () => {
        const candidate: QuietRecallCandidate = {
            id: "qr-self-only",
            title: "Recall: current",
            summary: "The current note backed this saved insight.",
            sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
            whyNow: ["Source matches the note you are looking at."],
            nextAction: "Compare this saved insight with the current note.",
            relation: "current",
            score: 90,
            generatedAt: "2026-06-29T12:00:00.000Z",
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-self-only",
        };
        const onLinkRecallCandidate = jest.fn(async () => ({ ok: true, message: "Linked" }));
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en", { onLinkRecallCandidate });
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

        expect(container.querySelector(".pa-pagelet-tab-recall-card")).not.toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-recall-link")).toBeNull();
        expect(onLinkRecallCandidate).not.toHaveBeenCalled();
    });

    it("separates local Discover clues from AI Recall cards and omits local why-now copy", () => {
        const aiCandidate: QuietRecallCandidate = {
            id: "qr-ai",
            title: "Recall: Accepted",
            summary: "An accepted source-backed recall.",
            sourceRefs: [{ path: "notes/accepted.md", evidenceStrength: "medium" }],
            whyNow: ["This accepted note resolves the question in the current note."],
            nextAction: "Open the accepted source.",
            relation: "related",
            score: 82,
            generatedAt: "2026-07-19T10:00:00.000Z",
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-accepted",
        };
        const localCandidate: QuietRecallCandidate = {
            id: "qr-local",
            title: "Recall: Local template title",
            summary: "LOCAL SUMMARY MUST NOT RENDER",
            sourceRefs: [{ path: "notes/local-clue.md", evidenceStrength: "medium" }],
            whyNow: ["LOCAL WHY NOW MUST NOT RENDER"],
            nextAction: "LOCAL NEXT ACTION MUST NOT RENDER",
            relation: "related",
            score: 78,
            generatedAt: "2026-07-19T10:00:00.000Z",
            evaluationProvenance: "local",
        };
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en", {
            onLinkRecallCandidate: jest.fn(async () => ({ ok: true, message: "Linked" })),
            onSaveQuietRecallAsInsight: jest.fn(async () => ({
                ok: false as const,
                reason: "write_failed" as const,
                message: "Not saved",
            })),
        });
        tab.mount(container as unknown as HTMLElement);
        tab.open("Quiet Recall", [], {
            layoutType: "current",
            extra: {
                quietRecall: {
                    generatedAt: aiCandidate.generatedAt,
                    currentPath: "notes/current.md",
                    totalCount: 1,
                    candidates: [aiCandidate],
                    discoverCandidates: [
                        { ...aiCandidate, evaluationProvenance: "local", evaluationFingerprint: undefined },
                        localCandidate,
                    ],
                },
            },
        });

        const recallCards = container.querySelectorAll(".pa-pagelet-tab-recall-card");
        const localCards = container.querySelectorAll(".pa-pagelet-tab-local-clue-card");
        const localCard = localCards[0];

        expect(recallCards).toHaveLength(1);
        expect(localCards).toHaveLength(1);
        expect(container.textContent).toContain("1 source-backed recalls are available.");
        expect(container.textContent).toContain("Why now: This accepted note resolves the question in the current note.");
        expect(localCard?.textContent).toContain("Local related clue");
        expect(localCard?.textContent).toContain("local-clue");
        expect(localCard?.textContent).toContain("Related by local note signals.");
        expect(localCard?.textContent).not.toContain("LOCAL WHY NOW MUST NOT RENDER");
        expect(localCard?.textContent).not.toContain("LOCAL SUMMARY MUST NOT RENDER");
        expect(localCard?.textContent).not.toContain("LOCAL NEXT ACTION MUST NOT RENDER");
        expect(localCard?.classList.contains("pa-pagelet-tab-card--source-list")).toBe(true);
        expect(localCard?.classList.contains("pa-pagelet-tab-recall-card")).toBe(false);
        expect(localCard?.querySelector(".pa-pagelet-tab-recall-save")).toBeNull();
        expect(recallCards[0]?.querySelector(".pa-pagelet-tab-recall-save")).not.toBeNull();
    });

    it("renders the dedicated Quiet Recall empty state when no candidate is strong enough", () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");
        tab.mount(container as unknown as HTMLElement);
        tab.open("Quiet Recall", [], {
            layoutType: "current",
            extra: {
                quietRecall: {
                    generatedAt: "2026-06-29T12:00:00.000Z",
                    currentPath: "notes/current.md",
                    totalCount: 0,
                    candidates: [],
                },
            },
        });

        expect(container.querySelector(".pa-pagelet-tab-quiet-recall")).not.toBeNull();
        expect(container.querySelector(".pa-pagelet-tab-recall-empty")).not.toBeNull();
        expect(container.textContent).toContain("No strong recall signal right now.");
        expect(container.textContent).not.toContain("No findings yet");
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
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-governed",
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
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-failure",
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
            extra: { markdown, savedInsights: { items: [makeSavedInsight()], totalCount: 1 },
                memoryGovernance: { records: [makeMemoryRecord({ summary: 'Prior Memory fact.' })], totalCount: 1 } },
            sourcePath: summarySaveNote.targetPath,
            summarySaveNote,
        });

        const contentEl = view.contentEl as unknown as FakeElement;
        const saveButton = contentEl.querySelector(".pa-pagelet-tab-summary-save");
        expect(saveButton).not.toBeNull();
        expect(saveButton?.textContent).toBe("Save as review note");
        await Promise.resolve();
        const nativeBody = contentEl.querySelector('.pa-pagelet-panel-summary-preview');
        const savedSection = contentEl.querySelector('.pa-pagelet-tab-saved-insights');
        (globalRecord.document as FakeDocument).dispatch('pointerdown', { target: nativeBody });
        view.setPayload({ title: 'Pagelet — Detail View', locale: 'en', layoutType: 'summary', content: [],
            summarySaveNote, sourcePath: summarySaveNote.targetPath,
            extra: { markdown: markdown + '\nUpdated summary.',
                savedInsights: { items: [makeSavedInsight()], totalCount: 1 },
                memoryGovernance: { records: [makeMemoryRecord({ summary: 'Current Memory fact.' })], totalCount: 1 } },
        });
        expect(contentEl.querySelector('.pa-pagelet-panel-summary-preview')).toBe(nativeBody);
        expect(nativeBody?.textContent).toBe(markdown);
        expect(contentEl.querySelector('.pa-pagelet-tab-saved-insights')).toBe(savedSection);
        expect(mockSavedLists).toHaveLength(1);
        expect(contentEl.textContent).not.toContain('Prior Memory fact.');
        expect(contentEl.textContent).toContain('Current Memory fact.');
        expect(contentEl.querySelector('.pa-pagelet-tab-summary-save')).toBe(saveButton);

        await saveButton?.click();

        expect(saveSummary).toHaveBeenCalledWith(summarySaveNote);
        expect(saveButton?.disabled).toBe(true);
        expect(saveButton?.getAttribute("aria-busy")).toBeNull();
        expect(saveButton?.textContent).toBe("Saved");
        const stateText = JSON.stringify(view.getState());
        expect(stateText).not.toContain(markdown);
        expect((view.getState() as { payload?: { summarySaveNote?: unknown } }).payload?.summarySaveNote).toBeUndefined();
        await view.onClose();
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

    it("clears only Scope Recap payloads from the in-memory native detail session", async () => {
        const createCachedSummary = async (
            entryReason: "scope-recap" | "default",
            marker: string,
        ): Promise<Record<string, unknown>> => {
            const view = new PageletDetailView({} as never, () => "en");
            await view.onOpen();
            view.setPayload({
                title: "Pagelet — Detail View",
                locale: "en",
                layoutType: "summary",
                content: [],
                entryReason,
                extra: { markdown: `# ${marker}\n\n${marker} body` },
            });
            return view.getState();
        };
        const restore = async (state: Record<string, unknown>): Promise<FakeElement> => {
            const view = new PageletDetailView({} as never, () => "en");
            await view.onOpen();
            await view.setState(state, {} as never);
            return view.contentEl as unknown as FakeElement;
        };

        const recapState = await createCachedSummary("scope-recap", "PRIVATE RECAP CACHE");
        const otherState = await createCachedSummary("default", "OTHER PAGELET CACHE");

        clearScopeRecapPageletDetailSessionCache();

        const restoredRecap = await restore(recapState);
        expect(restoredRecap.textContent).toContain("Result no longer available");
        expect(restoredRecap.textContent).not.toContain("PRIVATE RECAP CACHE");

        const restoredOther = await restore(otherState);
        expect(restoredOther.textContent).toContain("OTHER PAGELET CACHE body");
        expect(restoredOther.textContent).not.toContain("Result no longer available");
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
        expect(mockSavedLists.at(-1)?.props.items[0]?.text).toBe('Pricing notes keep coming back.');
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
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-entry-reason",
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

    it("uses Pet recovery copy only for a restored note-anchored Detail", async () => {
        const restoredNote = new PageletDetailView({} as never, () => "en");
        await restoredNote.onOpen();
        await restoredNote.setState({
            version: 5,
            payload: {
                locale: "en",
                sessionId: "missing-note-session",
                restoredFromState: true,
                sourcePath: "notes/current.md",
                layoutType: "discover",
            },
        }, {} as never);
        let contentEl = restoredNote.contentEl as unknown as FakeElement;
        expect(contentEl.textContent).toContain("Reading paused");
        expect(contentEl.textContent).toContain("click Pet to reconnect this tab");
        await restoredNote.onClose();

        const restoredAggregate = new PageletDetailView({} as never, () => "en");
        await restoredAggregate.onOpen();
        await restoredAggregate.setState({
            version: 5,
            payload: {
                locale: "en",
                sessionId: "missing-aggregate-session",
                restoredFromState: true,
            },
        }, {} as never);
        contentEl = restoredAggregate.contentEl as unknown as FakeElement;
        expect(contentEl.textContent).toContain("Result no longer available");
        expect(contentEl.textContent).toContain("open a saved review or summary note");
        expect(contentEl.textContent).not.toContain("click Pet to reconnect this tab");
        await restoredAggregate.onClose();
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

    it("commits only the exact rendered Quiet Recall target", () => {
        const candidate: QuietRecallCandidate = {
            id: "qr-delivery-target",
            title: "Recall: exact target",
            summary: "Only this rendered card may acknowledge delivery.",
            sourceRefs: [{ path: "notes/older.md", evidenceStrength: "medium" }],
            whyNow: ["This older note informs the current note."],
            nextAction: "Open it when useful.",
            relation: "related",
            score: 90,
            generatedAt: "2026-07-27T12:00:00.000Z",
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-detail-target",
        };
        const receipt = {
            version: 1 as const,
            kind: "recall" as const,
            fingerprint: "v1:recall:0000000000000001",
        };
        const onVisible = jest.fn();
        const target = {
            kind: "quiet-recall" as const,
            candidateId: candidate.id,
            receipt,
            onVisible,
        };
        const options = {
            layoutType: "current" as const,
            entryReason: "quiet-recall" as const,
            sourcePath: "notes/current.md",
            extra: {
                quietRecall: {
                    generatedAt: candidate.generatedAt,
                    currentPath: "notes/current.md",
                    totalCount: 1,
                    candidates: [candidate],
                },
            },
            deliveryTarget: target,
        };
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");
        tab.mount(container as unknown as HTMLElement);

        tab.open("Quiet Recall", [], options);
        tab.open("Quiet Recall", [], options);
        expect(onVisible).toHaveBeenCalledTimes(1);
        expect(onVisible).toHaveBeenCalledWith(receipt);

        const missingTarget = jest.fn();
        const failedContainer = new FakeElement("div");
        failedContainer.isConnected = true;
        const failedTab = new TabView("en");
        failedTab.mount(failedContainer as unknown as HTMLElement);
        failedTab.open("Quiet Recall", [], {
            ...options,
            deliveryTarget: {
                ...target,
                candidateId: "qr-not-rendered",
                onVisible: missingTarget,
            },
        });
        expect(missingTarget).not.toHaveBeenCalled();
    });

    it("commits a Recap receipt only when the exact target TabCard is rendered", () => {
        const targetCard = {
            title: "Target insight",
            body: "The exact Recap card.",
            cardStyle: "insight" as const,
        };
        const otherCard = {
            title: "Other insight",
            body: "A different rendered card.",
            cardStyle: "insight" as const,
        };
        const receipt = {
            version: 1 as const,
            kind: "recap" as const,
            fingerprint: "v1:recap:0000000000000002",
        };
        const onVisible = jest.fn();
        const deliveryTarget = {
            kind: "tab-card" as const,
            card: targetCard,
            receipt,
            onVisible,
        };
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");
        tab.mount(container as unknown as HTMLElement);

        tab.open("Scope Recap", [{ title: "Observations", cards: [otherCard] }], {
            deliveryTarget,
        });
        expect(onVisible).not.toHaveBeenCalled();

        tab.open("Scope Recap", [{ title: "Observations", cards: [otherCard, targetCard] }], {
            deliveryTarget,
        });
        tab.open("Scope Recap", [{ title: "Observations", cards: [targetCard] }], {
            deliveryTarget,
        });
        expect(onVisible).toHaveBeenCalledTimes(1);
        expect(onVisible).toHaveBeenCalledWith(receipt);
    });

    it("keeps deliveryTarget out of native view state and the detail session cache", async () => {
        const targetCard = {
            title: "Transient target",
            body: "Visible only in the live delivery.",
            cardStyle: "insight" as const,
        };
        const receipt = {
            version: 1 as const,
            kind: "recap" as const,
            fingerprint: "v1:recap:0000000000000003",
        };
        const onVisible = jest.fn();
        const view = new PageletDetailView({} as never, () => "en");
        await view.onOpen();
        view.setPayload({
            title: "Scope Recap",
            locale: "en",
            layoutType: "review",
            entryReason: "scope-recap",
            content: [{ title: "Observations", cards: [targetCard] }],
            deliveryTarget: {
                kind: "tab-card",
                card: targetCard,
                receipt,
                onVisible,
            },
        });
        expect(onVisible).toHaveBeenCalledTimes(1);

        const state = view.getState();
        expect(JSON.stringify(state)).not.toContain("deliveryTarget");
        expect(JSON.stringify(state)).not.toContain(receipt.fingerprint);

        const restored = new PageletDetailView({} as never, () => "en");
        await restored.onOpen();
        await restored.setState(state, {} as never);
        expect(onVisible).toHaveBeenCalledTimes(1);
        expect((restored as unknown as {
            payloadOptions: { deliveryTarget?: unknown };
        }).payloadOptions.deliveryTarget).toBeUndefined();
    });

    it("shows visible review progress and restores the panel after current-note review", async () => {
        let resolveReview = (): void => undefined;
        const reviewPromise = new Promise<void>((resolve) => {
            resolveReview = resolve;
        });
        const shareAsCard = jest.fn();
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
                onShareAsCard: shareAsCard,
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
        const shareButton = container.querySelector(".pa-pagelet-panel-share-btn");
        expect(shareButton?.disabled).toBe(true);
        expect(shareButton?.getAttribute("hidden")).toBe("");
        await shareButton?.click();
        expect(shareAsCard).not.toHaveBeenCalled();

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

    it("does not share stale findings while a review error replaces panel content", async () => {
        const shareAsCard = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onShareAsCard: shareAsCard,
            },
            getLocale: () => "en",
        });
        const staleFinding = {
            title: "Earlier result",
            description: "This result is no longer visible after the failed review.",
        };

        panel.mount(container as unknown as HTMLElement);
        panel.open("review", [staleFinding]);
        const shareButton = container.querySelector(".pa-pagelet-panel-share-btn");
        expect(panel.currentShareCardFindings).toEqual([staleFinding]);
        expect(shareButton?.disabled).toBe(false);

        panel.showReviewError("Review failed");

        expect(panel.currentShareCardFindings).toEqual([]);
        expect(shareButton?.disabled).toBe(true);
        expect(shareButton?.getAttribute("hidden")).toBe("");
        await shareButton?.click();
        expect(shareAsCard).not.toHaveBeenCalled();
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

    it("does not render retired time presets, note checkboxes, or Review selected", async () => {
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
            },
            getLocale: () => "en",
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("review", []);

        expect(container.querySelector(".pa-pagelet-panel-scope")).toBeNull();
        expect(container.querySelector(".pa-pagelet-panel-scope-range-btn")).toBeNull();
        expect(container.querySelector(".pa-pagelet-panel-scope-checkbox")).toBeNull();
        expect(container.textContent).not.toContain("Review selected");
        expect(container.querySelector(".pa-pagelet-panel-save-btn")?.textContent)
            .toContain("Review current note");
    });

    it("keeps a failed current review visible and retryable in the panel", async () => {
        const panelRef: { current: PanelView | null } = { current: null };
        const runReview = jest.fn(async () => {
            panelRef.current?.showReviewError("Pagelet review timed out. Try again, or shorten the note before retrying.");
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
                onRunReview: runReview,
            },
            getLocale: () => "en",
        });
        panelRef.current = panel;

        panel.mount(container as unknown as HTMLElement);
        panel.open("review", []);

        await container.querySelector(".pa-pagelet-panel-save-btn")?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(runReview).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain("Review did not finish");
        expect(container.textContent).toContain("Pagelet review timed out");
        expect(container.textContent).toContain("Retry");

        await container.querySelector(".pa-pagelet-panel-error-retry")?.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(runReview).toHaveBeenCalledTimes(2);
    });

    it("updates current review progress copy after a long provider wait", async () => {
        jest.useFakeTimers();
        try {
            const runReview = jest.fn(async () => new Promise<void>(() => undefined));
            const container = new FakeElement("div");
            container.isConnected = true;
            const panel = new PanelView({
                app: {} as never,
                callbacks: {
                    onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onRunReview: runReview,
                },
                getLocale: () => "en",
            });

            panel.mount(container as unknown as HTMLElement);
            panel.open("review", []);

            await container.querySelector(".pa-pagelet-panel-save-btn")?.click();
            expect(container.textContent).toContain("Reviewing current note");

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

    it("shares only visible findings and hides the action when the payload is empty", async () => {
        const shareAsCard = jest.fn();
        const container = new FakeElement("div");
        container.isConnected = true;
        const panel = new PanelView({
            app: {} as never,
            callbacks: {
                onClose: () => undefined,
                onExpandToTab: () => undefined,
                onSaveAsReviewNote: async () => undefined,
                onSourceClick: () => undefined,
                onShareAsCard: shareAsCard,
            },
            getLocale: () => "en",
        });
        const findings = [
            {
                title: "Expand",
                description: "First action.",
                sourceId: "seg-1",
                suggestion: {
                    source_id: "seg-1",
                    kind: "expand" as const,
                    rationale: "First reason.",
                    proposed_action: "First action.",
                    related_notes: [],
                },
            },
            {
                title: "Clarify",
                description: "Second action.",
                sourceId: "seg-2",
                suggestion: {
                    source_id: "seg-2",
                    kind: "clarify" as const,
                    rationale: "Second reason.",
                    proposed_action: "Second action.",
                    related_notes: [],
                },
            },
        ];

        panel.mount(container as unknown as HTMLElement);
        panel.open("current", findings, { sourcePath: "notes/current.md" });

        const shareButton = container.querySelector(".pa-pagelet-panel-share-btn");
        expect(shareButton?.disabled).toBe(false);
        expect(shareButton?.getAttribute("hidden")).toBeNull();
        await shareButton?.click();
        expect(shareAsCard).toHaveBeenLastCalledWith({
            findings,
        });

        await container.querySelector(".pa-pagelet-suggestion-card__btn--dismiss")?.click();
        await shareButton?.click();
        expect(shareAsCard).toHaveBeenLastCalledWith({
            findings: [findings[1]],
        });

        panel.open("current", [{
            title: "  ",
            description: "\n",
            insightText: "",
        }], { sourcePath: "notes/current.md" });
        expect(shareButton?.disabled).toBe(true);
        expect(shareButton?.getAttribute("hidden")).toBe("");
        await shareButton?.click();
        expect(shareAsCard).toHaveBeenCalledTimes(2);
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
        expect(container.querySelector(".pa-pagelet-panel-connection-graph-details")).toBeNull();
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

    it("collapses the Detail Discovery graph while retaining its instance and full relationship list", async () => {
        const container = new FakeElement("div");
        container.isConnected = true;
        const tab = new TabView("en");
        tab.mount(container as unknown as HTMLElement);
        tab.open("Pagelet — Detail View", [{
            title: "Current note links to diary",
            description: "Finding prose remains separate from the graph.",
            sourceFile: "2.fleeting/Test-2023-04-08.md",
        }], {
            layoutType: "discover",
            sourcePath: "2.fleeting/Test-2023-04-08.md",
            extra: {
                connections: [{
                    fromNote: "2.fleeting/Test-2023-04-08.md",
                    toNote: "Diary-2023-04-03.md",
                    strength: "medium" as const,
                    sharedConcepts: ["diary thread"],
                }],
            },
        });

        const details = container.querySelector(".pa-pagelet-panel-connection-graph-details") as FakeElement & { open: boolean };
        expect(details.getAttribute("open")).toBeNull();
        expect(details.open).toBe(true);
        const graph = container.querySelector(".pa-pagelet-panel-connection-graph");
        expect(container.textContent).toContain("Discovered Connections");
        expect(container.textContent).toContain("diary thread");

        await details.querySelector("summary")?.click();
        expect(details.open).toBe(false);
        expect(container.querySelector(".pa-pagelet-panel-connection-graph")).toBe(graph);
        expect(container.textContent).toContain("Discovered Connections");

        await details.querySelector("summary")?.click();
        expect(details.open).toBe(true);
        expect(container.querySelector(".pa-pagelet-panel-connection-graph")).toBe(graph);
        tab.destroy();
    });

    it("renders duplicated Deep Discover prose once through the safe markdown DOM path", async () => {
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
        const markdown = [
            "## Evidence",
            "",
            "- First source-backed point",
            "",
            "<img src=x onerror=alert(1)>",
        ].join("\n");

        panel.mount(container as unknown as HTMLElement);
        panel.open("discover", [{
            title: "Deep Discover",
            description: markdown,
            insightText: markdown,
            sourceFile: "notes/evidence.md",
        }], {
            sourcePath: "notes/current.md",
        });

        await Promise.resolve();
        expect(mockMarkdownRender).toHaveBeenCalledTimes(1);
        expect(container.querySelectorAll(".pa-pagelet-panel-timeline-meta")).toHaveLength(0);
        expect(container.querySelectorAll(".pa-pagelet-panel-timeline-insight")).toHaveLength(1);
    });

    it("renders Pagelet action preview as a polite status and keeps busy actions inert", async () => {
        const busyCallback = jest.fn();
        const confirmCallback = jest.fn();
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
        panel.open("discover", [{
            title: "Deep Discover",
            description: "Source-backed insight.",
            insightText: "Source-backed insight.",
            actionStatus: {
                label: "Review this one-note change before confirming.",
                detail: "Target: notes/current.md",
                preview: "Set pa-related: [\"[[notes/related]]\"]",
                busy: true,
            },
            actions: [
                { label: "Preparing", busy: true, callback: busyCallback },
                { label: "Confirm", primary: true, callback: confirmCallback },
            ],
        }], {
            sourcePath: "notes/current.md",
        });

        const status = container.querySelector(".pa-pagelet-panel-action-status");
        expect(status?.getAttribute("role")).toBe("status");
        expect(status?.getAttribute("aria-live")).toBe("polite");
        expect(status?.getAttribute("aria-busy")).toBe("true");
        expect(container.querySelector(".pa-pagelet-panel-action-status-preview")?.textContent)
            .toBe("Set pa-related: [\"[[notes/related]]\"]");
        const buttons = container.querySelectorAll(".pa-pagelet-panel-timeline-action-btn");
        expect(buttons).toHaveLength(2);
        expect(buttons[0]?.disabled).toBe(true);
        expect(buttons[0]?.getAttribute("aria-busy")).toBe("true");
        expect(buttons[1]?.classList.contains("pa-pagelet-panel-timeline-action-btn--primary")).toBe(true);

        await buttons[0]?.click();
        await buttons[1]?.click();
        expect(busyCallback).not.toHaveBeenCalled();
        expect(confirmCallback).toHaveBeenCalledTimes(1);
    });

    it("preserves action focus and moves it through busy status to the next primary action", () => {
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
        const finding = (
            label: string,
            actions: Array<{ label: string; primary?: boolean; busy?: boolean }>,
            busy = false,
        ) => ({
            title: "Deep Discover",
            description: "Source-backed insight.",
            insightText: "Source-backed insight.",
            actionStatus: { label, busy },
            actions: actions.map((action) => ({ ...action, callback: () => undefined })),
        });

        panel.mount(container as unknown as HTMLElement);
        panel.open("discover", [finding("Review before confirming.", [
            { label: "Confirm", primary: true },
            { label: "Cancel" },
        ])]);

        const pendingButtons = container.querySelectorAll(".pa-pagelet-panel-timeline-action-btn");
        pendingButtons[1]?.focus();
        panel.open("discover", [finding("Review before confirming.", [
            { label: "Confirm", primary: true },
            { label: "Cancel" },
        ])]);
        expect((globalRecord.document as FakeDocument).activeElement?.textContent).toBe("Cancel");

        const refreshedConfirm = container.querySelectorAll(".pa-pagelet-panel-timeline-action-btn")[0];
        refreshedConfirm?.focus();
        panel.open("discover", [finding("Applying the confirmed change…", [
            { label: "Confirm", busy: true },
        ], true)]);

        const busyStatus = container.querySelector(".pa-pagelet-panel-action-status");
        expect(busyStatus?.getAttribute("tabindex")).toBe("-1");
        expect((globalRecord.document as FakeDocument).activeElement).toBe(busyStatus);

        panel.open("discover", [finding("The related-note link was added.", [
            { label: "Undo", primary: true },
        ])]);
        const undo = container.querySelector(".pa-pagelet-panel-timeline-action-btn");
        expect(undo?.textContent).toBe("Undo");
        expect((globalRecord.document as FakeDocument).activeElement).toBe(undo);
    });

    it("shows complete single-note Markdown without an empty connection map", async () => {
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
        const body = "## Wording issue\n\nA supported observation.\n\n### Another finding\nThe full text remains readable.";
        panel.mount(container as unknown as HTMLElement);
        panel.open("discover", [{
            title: "Wording issue", description: body, insightText: body, sourceFile: "notes/current.md",
        }], { sourcePath: "notes/current.md" });
        await Promise.resolve();

        expect(container.querySelector(".pa-pagelet-panel-connection-graph")).toBeNull();
        expect(container.querySelector(".pa-pagelet-panel-timeline-insight")?.textContent).toBe(body);
        expect(container.querySelectorAll(".pa-pagelet-panel-source-chip")).toHaveLength(1);
        expect(mockMarkdownRender).toHaveBeenCalledWith(
            expect.anything(), body, expect.anything(), "notes/current.md", expect.anything(),
        );
    });

    it("keeps every discovery source visible and clickable outside the capped graph", async () => {
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
        const sourcePaths = Array.from(
            { length: 10 },
            (_, index) => `sources/evidence-${index + 1}.md`,
        );

        panel.mount(container as unknown as HTMLElement);
        panel.open("discover", sourcePaths.map((sourceFile, index) => ({
            title: `Evidence ${index + 1}`,
            description: index === 0 ? "Source-backed insight." : sourceFile,
            ...(index === 0 ? { insightText: "Source-backed insight." } : {}),
            sourceFile,
        })), {
            sourcePath: "notes/current.md",
        });

        expect(container.querySelectorAll(".pa-pagelet-panel-connection-node")).toHaveLength(8);
        const sourceChips = container.querySelectorAll(".pa-pagelet-panel-source-chip");
        expect(sourceChips).toHaveLength(sourcePaths.length);
        expect(sourceChips.map((chip) => chip.textContent)).toEqual(
            sourcePaths.map((p) => p.split("/").pop()!.replace(/\.md$/i, "")),
        );

        await sourceChips[9]?.click();
        expect(relatedNoteClick).toHaveBeenCalledWith(
            sourcePaths[9],
            "notes/current.md",
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
