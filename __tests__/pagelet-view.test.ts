/* Copyright 2023 edonyzpc */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian");

import type { WorkspaceLeaf } from "obsidian";

import type { PreviewSpec } from "../src/ai-services/write-action-framework";
import type { PluginManager } from "../src/plugin";
import type { PageletCostSummary } from "../src/pagelet/pa-review-cost";
import type { PageletReviewDiagnostics } from "../src/pagelet/pa-review-model";
import type { PageletSuggestion } from "../src/pagelet/pa-review-schemas";
import type {
    PageletReviewRange,
    PageletScopePlan,
    PageletScopeSourceReference,
} from "../src/pagelet/scope";
import { PageletView } from "../src/pagelet/view";

const DRAFT_STORAGE_KEY = "personal-assistant:pagelet:pending-draft:v1";

type FakeListener = (event: unknown) => void;

class FakeClassList {
    constructor(private readonly owner: FakeElement) { }

    add(...classes: string[]): void {
        const tokens = new Set(this.tokens());
        for (const cls of classes) {
            if (cls.length > 0) tokens.add(cls);
        }
        this.owner.className = [...tokens].join(" ");
    }

    contains(cls: string): boolean {
        return this.tokens().includes(cls);
    }

    toggle(cls: string, force?: boolean): boolean {
        const tokens = new Set(this.tokens());
        const shouldAdd = force ?? !tokens.has(cls);
        if (shouldAdd) {
            tokens.add(cls);
        } else {
            tokens.delete(cls);
        }
        this.owner.className = [...tokens].join(" ");
        return shouldAdd;
    }

    private tokens(): string[] {
        return splitClasses(this.owner.className);
    }
}

class FakeStyle {
    readonly props = new Map<string, string>();

    setProperty(name: string, value: string): void {
        this.props.set(name, value);
    }
}

class FakeElement {
    className = "";
    readonly attributes = new Map<string, string>();
    readonly children: FakeElement[] = [];
    parentElement: FakeElement | null = null;
    readonly classList = new FakeClassList(this);
    readonly style = new FakeStyle();
    checked = false;
    disabled = false;
    hidden = false;
    value = "";
    private readonly listeners = new Map<string, FakeListener[]>();
    private textValue = "";

    constructor(
        readonly tagName: string,
        readonly namespace: "html" | "svg" = "html",
    ) { }

    get textContent(): string {
        return this.textValue;
    }

    set textContent(value: string | null) {
        this.textValue = value ?? "";
        for (const child of this.children) child.parentElement = null;
        this.children.splice(0);
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
        if (name === "class") this.className = value;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
        if (name === "class") this.className = "";
    }

    appendChild<T extends FakeElement>(child: T): T {
        if (child.parentElement) child.parentElement.removeChild(child);
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    removeChild<T extends FakeElement>(child: T): T {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.parentElement = null;
        return child;
    }

    remove(): void {
        this.parentElement?.removeChild(this);
    }

    addEventListener(event: string, listener: unknown): void {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(listener as FakeListener);
        this.listeners.set(event, listeners);
    }

    removeEventListener(event: string, listener: unknown): void {
        const listeners = this.listeners.get(event);
        if (!listeners) return;
        const index = listeners.indexOf(listener as FakeListener);
        if (index >= 0) listeners.splice(index, 1);
    }

    dispatch(event: string, payload: unknown = { type: event }): void {
        for (const listener of [...(this.listeners.get(event) ?? [])]) {
            listener(payload);
        }
    }
}

function splitClasses(className: string): string[] {
    return className.split(/\s+/).filter(Boolean);
}

function hasClass(node: FakeElement, className: string): boolean {
    return splitClasses(node.className).includes(className);
}

function findAllByClass(root: FakeElement, className: string): FakeElement[] {
    const results: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
        if (hasClass(node, className)) results.push(node);
        for (const child of node.children) walk(child);
    };
    walk(root);
    return results;
}

function findByClass(root: FakeElement, className: string): FakeElement {
    const results = findAllByClass(root, className);
    if (results.length !== 1) {
        throw new Error(`expected exactly one .${className}, got ${results.length}`);
    }
    return results[0];
}

function findAllByTag(root: FakeElement, tagName: string): FakeElement[] {
    const expected = tagName.toLowerCase();
    const results: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
        if (node.tagName.toLowerCase() === expected) results.push(node);
        for (const child of node.children) walk(child);
    };
    walk(root);
    return results;
}

function makePluginStub() {
    return {
        refreshPageletScope: jest.fn(async (_range: PageletReviewRange) => undefined),
        runPageletReviewForPageletScope: jest.fn(async () => undefined),
        openPageletSourceReference: jest.fn(async (_reference: PageletScopeSourceReference) => true),
        openPageletRelatedNote: jest.fn(async (_noteName: string, _sourcePath: string) => true),
        preparePageletResearchPrompt: jest.fn(async (_suggestion: PageletSuggestion) => true),
    };
}

function makeView(plugin = makePluginStub()): {
    view: PageletView;
    plugin: ReturnType<typeof makePluginStub>;
    contentEl: FakeElement;
} {
    const contentEl = new FakeElement("div");
    const leaf = {
        app: {},
        containerEl: new FakeElement("div") as unknown as HTMLElement,
    } as unknown as WorkspaceLeaf;
    const view = new PageletView(leaf, plugin as unknown as PluginManager);
    (view as unknown as { contentEl: HTMLElement }).contentEl = contentEl as unknown as HTMLElement;
    return { view, plugin, contentEl };
}

function makeSuggestion(overrides: Partial<PageletSuggestion> = {}): PageletSuggestion {
    return {
        source_id: "seg-1",
        kind: "link",
        rationale: "This claim references a nearby concept but does not link it yet.",
        proposed_action: "Add a wiki link to [[Related Concept]] near this claim.",
        related_notes: ["[[Related Concept]]"],
        ...overrides,
    };
}

function makeDiagnostics(): PageletReviewDiagnostics {
    return {
        path: "structured",
        attempts: 1,
        truncated: false,
        partial: false,
        droppedSuggestionsCount: 0,
        schemaErrors: [],
        elapsedMs: 12,
    };
}

function makeCostSummary(): PageletCostSummary {
    return {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        estimatedCost: 0.001,
        currency: "USD",
        pricingKnown: true,
        entries: [],
    };
}

function makeReviewData(sourcePath: string, suggestion = makeSuggestion()) {
    return {
        sourcePath,
        result: {
            schema_version: 1 as const,
            detected_language: "en" as const,
            suggestions: [suggestion],
            overall_remark: "One suggestion is ready.",
        },
        diagnostics: makeDiagnostics(),
        costSummary: makeCostSummary(),
        targetPath: `.pagelet/${sourcePath.replace(/\.md$/, "")}-pagelet-review-2026-06-06.md`,
        sourceReferences: [
            {
                sourceId: suggestion.source_id,
                path: sourcePath,
                segmentIndex: 0,
                label: `${sourcePath} #1`,
            },
        ],
        sourcePaths: [sourcePath],
    };
}

function makeScopePlan(activePath: string): PageletScopePlan {
    return {
        range: "current",
        activePath,
        rangeStartMs: 0,
        rangeEndMs: 1,
        candidates: [
            {
                path: activePath,
                reason: "active",
                included: true,
                modifiedAt: 1,
                createdAt: 1,
            },
        ],
    };
}

function makePreviewSpec(overrides: Partial<PreviewSpec> = {}): PreviewSpec {
    return {
        operationType: "create-file",
        actionFamily: "create-file",
        capabilityId: "pagelet.write_review_output",
        target: {
            kind: "vault-path",
            displayPath: ".pagelet/alpha-pagelet-review.md",
            folder: ".pagelet/",
            filename: "alpha-pagelet-review.md",
        },
        contentPreview: {
            format: "markdown",
            body: "# Review\n\n- Keep this suggestion.",
            byteSize: 32,
        },
        impact: {
            usesAiProvider: false,
            usesAiCredits: false,
            affectsExternalState: false,
        },
        riskNotes: [],
        confirmCopy: {
            confirmLabel: "Save review note",
            cancelLabel: "Cancel",
        },
        ...overrides,
    };
}

function getDraftSnapshot(storage: Map<string, string>): unknown {
    const raw = storage.get(DRAFT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
}

let previousDocument: PropertyDescriptor | undefined;
let previousLocalStorage: PropertyDescriptor | undefined;
let storage: Map<string, string>;

beforeEach(() => {
    previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    storage = new Map<string, string>();

    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: (tagName: string) => new FakeElement(tagName) as unknown as HTMLElement,
            createElementNS: (_namespace: string, tagName: string) =>
                new FakeElement(tagName, "svg") as unknown as SVGElement,
        },
    });
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => {
                storage.set(key, value);
            },
            removeItem: (key: string) => {
                storage.delete(key);
            },
        },
    });
});

afterEach(() => {
    if (previousDocument) {
        Object.defineProperty(globalThis, "document", previousDocument);
    } else {
        delete (globalThis as { document?: Document }).document;
    }
    if (previousLocalStorage) {
        Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
    } else {
        delete (globalThis as { localStorage?: Storage }).localStorage;
    }
});

describe("PageletView workbench interactions", () => {
    it("persists accepted draft edits, restores them for the same source, and clears them on remove", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");
        const textarea = findAllByTag(contentEl, "textarea")[0];
        expect(textarea.value).toBe("Add a wiki link to [[Related Concept]] near this claim.");

        textarea.value = "Edited draft block";
        textarea.dispatch("input");
        expect(getDraftSnapshot(storage)).toMatchObject({
            version: 1,
            sourcePath: "notes/alpha.md",
            items: [{ text: "Edited draft block" }],
        });

        const reopened = makeView();
        await reopened.view.onOpen();
        reopened.view.showScopePlan(makeScopePlan("notes/alpha.md"));
        expect(findAllByTag(reopened.contentEl, "textarea")[0].value).toBe("Edited draft block");

        findByClass(reopened.contentEl, "pa-pagelet-button--ghost").dispatch("click");
        expect(findAllByTag(reopened.contentEl, "textarea")).toHaveLength(0);
        expect(storage.get(DRAFT_STORAGE_KEY)).toBeUndefined();
    });

    it("does not restore a pending draft onto a different active source", async () => {
        storage.set(DRAFT_STORAGE_KEY, JSON.stringify({
            version: 1,
            sourcePath: "notes/alpha.md",
            items: [
                {
                    key: "seg-1\u001flink\u001fAdd a wiki link to [[Related Concept]] near this claim.",
                    suggestion: makeSuggestion(),
                    text: "Stale draft",
                },
            ],
        }));

        const { view, contentEl } = makeView();
        await view.onOpen();
        expect(findAllByTag(contentEl, "textarea")).toHaveLength(0);
        view.showScopePlan(makeScopePlan("notes/beta.md"));

        expect(findAllByTag(contentEl, "textarea")).toHaveLength(0);
        expect(storage.get(DRAFT_STORAGE_KEY)).toBeUndefined();
    });

    it("labels the panel review action by selected count and exposes provider disclosure", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showScopePlan({
            ...makeScopePlan("notes/alpha.md"),
            range: "last3",
            candidates: [
                {
                    path: "notes/alpha.md",
                    reason: "active",
                    included: true,
                    modifiedAt: 1,
                    createdAt: 1,
                },
                {
                    path: "notes/beta.md",
                    reason: "modified",
                    included: true,
                    modifiedAt: 1,
                    createdAt: 1,
                },
            ],
        });

        const button = findByClass(contentEl, "pa-pagelet-button--primary");
        expect(button.textContent).toBe("Review selected (2)");
        expect(button.getAttribute("aria-label")).toContain("2 selected notes");
        expect(view.getScopeSelection()).toMatchObject({
            activePath: "notes/alpha.md",
            paths: ["notes/alpha.md", "notes/beta.md"],
        });
    });

    it("shows a stop action while review is running and restores review controls afterward", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showScopePlan(makeScopePlan("notes/alpha.md"));

        const reviewButton = findByClass(contentEl, "pa-pagelet-button--primary");
        const stopButton = findAllByTag(contentEl, "button")
            .find((button) => button.textContent === "Stop");
        expect(stopButton).toBeDefined();
        expect(stopButton?.hidden).toBe(true);
        expect(reviewButton.disabled).toBe(false);

        const onCancel = jest.fn();
        view.showReviewStarted("notes/alpha.md", { onCancel });

        expect(reviewButton.disabled).toBe(true);
        expect(stopButton?.hidden).toBe(false);
        stopButton?.dispatch("click");
        expect(onCancel).toHaveBeenCalledTimes(1);

        view.showReviewAborted("notes/alpha.md");
        expect(reviewButton.disabled).toBe(false);
        expect(stopButton?.hidden).toBe(true);
    });

    it("renders review-output exclusions as an aggregate scope summary", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showScopePlan({
            ...makeScopePlan("notes/alpha.md"),
            excludedReviewOutputCount: 3,
        });

        expect(findByClass(contentEl, "pa-pagelet-scope__summary").textContent)
            .toBe("Excluded: 3 Pagelet review notes");
        expect(findAllByClass(contentEl, "pa-pagelet-scope__path")
            .some((node) => node.textContent.includes(".pagelet/")))
            .toBe(false);
    });

    it("marks suggestions and draft editors with accessible names", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));
        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");

        const cards = findByClass(contentEl, "pa-pagelet-cards");
        expect(cards.getAttribute("role")).toBe("region");
        expect(cards.getAttribute("aria-live")).toBe("polite");
        const textarea = findAllByTag(contentEl, "textarea")[0];
        expect(textarea.getAttribute("aria-label")).toBe("Draft block: seg-1");
    });

    it("wires source, related-note, and research card actions through the plugin boundary", async () => {
        const { view, plugin, contentEl } = makeView();
        const suggestion = makeSuggestion();
        const data = makeReviewData("notes/alpha.md", suggestion);
        await view.onOpen();
        view.showReviewResult(data);

        findByClass(contentEl, "pa-pagelet-suggestion-card__source-chip--interactive").dispatch("click");
        findByClass(contentEl, "pa-pagelet-suggestion-card__related-button").dispatch("click");
        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--research").dispatch("click");
        await Promise.resolve();

        expect(plugin.openPageletSourceReference).toHaveBeenCalledWith(data.sourceReferences[0]);
        expect(plugin.openPageletRelatedNote).toHaveBeenCalledWith(
            "[[Related Concept]]",
            "notes/alpha.md",
        );
        expect(plugin.preparePageletResearchPrompt).toHaveBeenCalledWith(suggestion);
    });

    it("reports when Chat already has a draft and research prompt is not replaced", async () => {
        const plugin = {
            ...makePluginStub(),
            preparePageletResearchPrompt: jest.fn(async () => false),
        };
        const { view, contentEl } = makeView(plugin);
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md", makeSuggestion({ kind: "evidence" })));

        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--research").dispatch("click");
        await Promise.resolve();

        expect(findByClass(contentEl, "pa-pagelet-status__state").textContent)
            .toBe("Chat already has text; prompt not replaced");
    });

    it("renders write confirmation in the Pagelet panel and resolves confirmed", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        const resultPromise = view.showWritePreview(makePreviewSpec());
        expect(findByClass(contentEl, "pa-pagelet-write-preview__target").textContent)
            .toBe("Target: .pagelet/alpha-pagelet-review.md");
        const toggle = findByClass(contentEl, "pa-pagelet-write-preview__toggle");
        const markdown = findByClass(contentEl, "pa-pagelet-write-preview__markdown");
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(markdown.hidden).toBe(true);
        toggle.dispatch("click");
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(markdown.hidden).toBe(false);
        expect(markdown.textContent).toContain("Keep this suggestion");

        findByClass(contentEl, "pa-pagelet-write-preview__confirm").dispatch("click");
        await expect(resultPromise).resolves.toEqual({ outcome: "confirmed" });
        expect(findByClass(contentEl, "pa-pagelet-status__state").textContent)
            .toBe("Saving review note...");
        expect(findByClass(contentEl, "pa-pagelet-write-preview__confirm").disabled).toBe(true);
    });

    it("resolves cancelled and clears the panel write confirmation", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        const resultPromise = view.showWritePreview(makePreviewSpec());
        findByClass(contentEl, "pa-pagelet-write-preview__cancel").dispatch("click");

        await expect(resultPromise).resolves.toEqual({ outcome: "cancelled" });
        expect(findAllByClass(contentEl, "pa-pagelet-write-preview")).toHaveLength(0);
    });

    it("maps AbortSignal and view close to non-write outcomes", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        const controller = new AbortController();
        const aborted = view.showWritePreview(makePreviewSpec(), { signal: controller.signal });
        controller.abort();
        await expect(aborted).resolves.toEqual({ outcome: "aborted" });
        expect(findAllByClass(contentEl, "pa-pagelet-write-preview")).toHaveLength(0);

        const closed = view.showWritePreview(makePreviewSpec());
        await view.onClose();
        await expect(closed).resolves.toEqual({ outcome: "cancelled" });
    });
});
