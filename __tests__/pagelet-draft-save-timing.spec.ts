/* Copyright 2023 edonyzpc */

/**
 * Draft save timing guards — re-entrancy, abort-during-settlement, and
 * reconcile-on-source-change runtime clearing.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian");

import type { WorkspaceLeaf } from "obsidian";

import type { PageletDraftReviewSaveRequest, PageletViewCallbacks } from "../src/pagelet/view";
import type { PageletCostSummary } from "../src/pagelet/pa-review-cost";
import type { PageletReviewDiagnostics } from "../src/pagelet/pa-review-model";
import type { PageletSuggestion } from "../src/pagelet/pa-review-schemas";
import type {
    PageletScopePlan,
    PageletReviewRange,
    PageletScopeSourceReference,
} from "../src/pagelet/scope";
import { PageletView } from "../src/pagelet/view";
import { DomStubNode, findByClass, findAllByClass, findAllByTag } from "./helpers/dom-stub";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DRAFT_STORAGE_KEY = "personal-assistant:pagelet:pending-draft:v1";

function makeCallbacks() {
    return {
        refreshScope: jest.fn((_range: PageletReviewRange, _activePath?: string) => undefined),
        runReview: jest.fn(() => undefined),
        saveDraftReview: jest.fn(async (_request: PageletDraftReviewSaveRequest): Promise<void> => undefined),
        openSourceReference: jest.fn(async (_reference: PageletScopeSourceReference) => true),
        openRelatedNote: jest.fn(async (_noteName: string, _sourcePath: string) => true),
        prepareResearchPrompt: jest.fn(async (_suggestion: PageletSuggestion) => true),
    };
}

function makeView(callbacks = makeCallbacks()): {
    view: PageletView;
    callbacks: ReturnType<typeof makeCallbacks>;
    contentEl: DomStubNode;
} {
    const contentEl = new DomStubNode("div");
    const leaf = {
        app: {},
        containerEl: new DomStubNode("div") as unknown as HTMLElement,
    } as unknown as WorkspaceLeaf;
    const view = new PageletView(leaf, callbacks as unknown as PageletViewCallbacks);
    (view as unknown as { contentEl: HTMLElement }).contentEl = contentEl as unknown as HTMLElement;
    return { view, callbacks, contentEl };
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

function installGlobalStub(
    name: string,
    value: unknown,
): { restore(): void } {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    return {
        restore() {
            if (previous) {
                Object.defineProperty(globalThis, name, previous);
            } else {
                delete (globalThis as Record<string, unknown>)[name];
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Draft save timing guards", () => {
    let storage: Map<string, string>;
    const stubs: Array<{ restore(): void }> = [];

    beforeEach(() => {
        storage = new Map<string, string>();
        stubs.push(installGlobalStub("document", {
            createElement: (tagName: string) => new DomStubNode(tagName) as unknown as HTMLElement,
            createElementNS: (_namespace: string, tagName: string) =>
                new DomStubNode(tagName, "svg") as unknown as SVGElement,
        }));
        stubs.push(installGlobalStub("localStorage", {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
        }));
    });

    afterEach(() => {
        while (stubs.length > 0) stubs.pop()!.restore();
    });

    it("re-entrancy guard blocks second save, unlocks after first resolves", async () => {
        const { view, callbacks, contentEl } = makeView();
        let resolveSave!: () => void;
        const savePromise = new Promise<void>((resolve) => {
            resolveSave = resolve;
        });
        callbacks.saveDraftReview.mockImplementation(
            async (_request: PageletDraftReviewSaveRequest) => savePromise,
        );
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");

        // First save enters in-flight state
        findByClass(contentEl, "pa-pagelet-draft__save").dispatch("click");
        expect(callbacks.saveDraftReview).toHaveBeenCalledTimes(1);

        // Second click is blocked by re-entrancy guard
        findByClass(contentEl, "pa-pagelet-draft__save").dispatch("click");
        expect(callbacks.saveDraftReview).toHaveBeenCalledTimes(1);

        // Save button should be disabled
        const saveButton = findByClass(contentEl, "pa-pagelet-draft__save");
        expect(saveButton.disabled).toBe(true);

        // Resolve the first save — should unlock
        resolveSave();
        await savePromise;
        // Allow .catch()/.finally() microtask chain to settle
        await new Promise((r) => setTimeout(r, 0));

        // After resolve, save button should be re-enabled
        const saveButtonAfter = findByClass(contentEl, "pa-pagelet-draft__save");
        expect(saveButtonAfter.disabled).toBe(false);

        // A new save should now be possible
        callbacks.saveDraftReview.mockImplementation(
            async (_request: PageletDraftReviewSaveRequest) => undefined,
        );
        saveButtonAfter.dispatch("click");
        expect(callbacks.saveDraftReview).toHaveBeenCalledTimes(2);
    });

    it(".finally() early-returns when abort was called during promise settlement", async () => {
        const { view, callbacks, contentEl } = makeView();
        let resolveSave!: () => void;
        const savePromise = new Promise<void>((resolve) => {
            resolveSave = resolve;
        });
        callbacks.saveDraftReview.mockImplementation(
            async (_request: PageletDraftReviewSaveRequest) => savePromise,
        );
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");
        findByClass(contentEl, "pa-pagelet-draft__save").dispatch("click");
        expect(callbacks.saveDraftReview).toHaveBeenCalledTimes(1);

        // Simulate view close which calls abortDraftSave()
        await view.onClose();

        // Now resolve the deferred promise — .finally() should early-return
        // because draftSaveInFlight was already set to false by abortDraftSave
        resolveSave();
        await savePromise;
        await Promise.resolve();

        // No error thrown means .finally() returned early without touching
        // null DOM refs (the view is closed)
        expect(callbacks.saveDraftReview).toHaveBeenCalledTimes(1);
    });

    it("reconcileDraftWithSource clears draft when source path changes at runtime", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        // Accept a suggestion to build a draft
        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");
        expect(findAllByTag(contentEl, "textarea")).toHaveLength(1);
        expect(storage.get(DRAFT_STORAGE_KEY)).toBeDefined();

        // Switch to a different source — triggers reconcileDraftWithSource
        view.showScopePlan(makeScopePlan("notes/beta.md"));

        // Draft should be cleared
        expect(findAllByTag(contentEl, "textarea")).toHaveLength(0);
        expect(storage.get(DRAFT_STORAGE_KEY)).toBeUndefined();
    });
});
