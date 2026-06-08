/* Copyright 2023 edonyzpc */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian");

import type { WorkspaceLeaf } from "obsidian";

import type { PreviewSpec } from "../src/ai-services/write-action-framework";
import type { PageletDraftReviewSaveRequest, PageletViewCallbacks } from "../src/pagelet/view";
import type { PageletCostSummary } from "../src/pagelet/pa-review-cost";
import type { PageletReviewDiagnostics } from "../src/pagelet/pa-review-model";
import type { PageletSuggestion } from "../src/pagelet/pa-review-schemas";
import type {
    PageletReviewRange,
    PageletScopePlan,
    PageletScopeSourceReference,
} from "../src/pagelet/scope";
import { PageletView } from "../src/pagelet/view";
import { DomStubNode, findByClass, findAllByClass, findAllByTag } from "./helpers/dom-stub";

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

describe("PageletView workbench interactions", () => {
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

    it("saves the user-edited draft instead of the raw review result", async () => {
        const { view, callbacks, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult({
            ...makeReviewData("Last 3 days · 2 notes"),
            primarySourcePath: "notes/alpha.md",
            targetPath: ".pagelet/alpha-pagelet-review-2026-06-06.md",
            detectedLanguage: "en",
            mode: "basic",
            sourcePaths: ["notes/alpha.md", "notes/beta.md"],
        });

        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");
        const textarea = findAllByTag(contentEl, "textarea")[0];
        textarea.value = "Edited draft action";
        textarea.dispatch("input");

        findByClass(contentEl, "pa-pagelet-draft__save").dispatch("click");
        await Promise.resolve();

        expect(callbacks.saveDraftReview).toHaveBeenCalledTimes(1);
        expect(callbacks.saveDraftReview.mock.calls[0][0]).toMatchObject({
            sourcePath: "notes/alpha.md",
            targetPath: ".pagelet/alpha-pagelet-review-2026-06-06.md",
            detectedLanguage: "en",
            mode: "basic",
            result: {
                suggestions: [
                    {
                        source_id: "seg-1",
                        proposed_action: "Edited draft action",
                    },
                ],
            },
        });
    });

    it("keeps multi-note draft identity on the primary source path", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult({
            ...makeReviewData("Last 3 days · 2 notes"),
            primarySourcePath: "notes/alpha.md",
            sourcePaths: ["notes/alpha.md", "notes/beta.md"],
        });

        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");
        const textarea = findAllByTag(contentEl, "textarea")[0];
        textarea.value = "Multi-note draft action";
        textarea.dispatch("input");

        expect(getDraftSnapshot(storage)).toMatchObject({
            sourcePath: "notes/alpha.md",
            items: [{ text: "Multi-note draft action" }],
        });

        view.showScopePlan(makeScopePlan("notes/alpha.md"));

        expect(findAllByTag(contentEl, "textarea")[0].value).toBe("Multi-note draft action");
        expect(storage.get(DRAFT_STORAGE_KEY)).toBeDefined();
    });

    it("does not submit draft save twice while a save is pending", async () => {
        const { view, callbacks, contentEl } = makeView();
        let resolveSave!: () => void;
        const savePromise = new Promise<void>((resolve) => {
            resolveSave = resolve;
        });
        callbacks.saveDraftReview.mockImplementation(async (_request: PageletDraftReviewSaveRequest) => savePromise);
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));
        callbacks.refreshScope.mockClear();

        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");
        findByClass(contentEl, "pa-pagelet-draft__save").dispatch("click");
        findByClass(contentEl, "pa-pagelet-draft__save").dispatch("click");

        expect(callbacks.saveDraftReview).toHaveBeenCalledTimes(1);
        const reviewButton = findAllByTag(contentEl, "button")
            .find((button) => button.textContent.startsWith("Review selected"));
        expect(reviewButton?.disabled).toBe(true);
        reviewButton?.dispatch("click");
        expect(callbacks.runReview).not.toHaveBeenCalled();
        const scopeButtons = findAllByClass(contentEl, "pa-pagelet-scope__range");
        expect(scopeButtons.every((button) => button.disabled)).toBe(true);
        scopeButtons[1].dispatch("click");
        expect(callbacks.refreshScope).not.toHaveBeenCalled();

        resolveSave();
        await savePromise;
        await Promise.resolve();
    });

    it("preserves the draft and cards when saving fails", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");
        const textarea = findAllByTag(contentEl, "textarea")[0];
        textarea.value = "Retryable draft";
        textarea.dispatch("input");

        view.showReviewSaveError("Vault write failed", "notes/alpha.md");

        expect(findByClass(contentEl, "pa-pagelet-status__state").textContent)
            .toBe("Vault write failed");
        expect(findAllByTag(contentEl, "textarea")[0].value).toBe("Retryable draft");
        expect(findAllByClass(contentEl, "pa-pagelet-suggestion-card")).toHaveLength(1);
        expect(findAllByClass(contentEl, "pa-pagelet-draft__save")).toHaveLength(1);
        expect(getDraftSnapshot(storage)).toMatchObject({
            sourcePath: "notes/alpha.md",
            items: [{ text: "Retryable draft" }],
        });
    });

    it("makes a saved review result complete instead of reusing its target path", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--accept").dispatch("click");
        view.showReviewSaved(".pagelet/alpha-pagelet-review-2026-06-06.md", makeCostSummary());

        expect(findByClass(contentEl, "pa-pagelet-status__state").textContent)
            .toBe("Review note saved");
        expect(findAllByClass(contentEl, "pa-pagelet-suggestion-card")).toHaveLength(0);
        expect(findAllByTag(contentEl, "textarea")).toHaveLength(0);
        expect(findAllByClass(contentEl, "pa-pagelet-draft__save")).toHaveLength(0);
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

    it("wires source, related-note, and research card actions through the callback boundary", async () => {
        const { view, callbacks, contentEl } = makeView();
        const suggestion = makeSuggestion();
        const data = makeReviewData("notes/alpha.md", suggestion);
        await view.onOpen();
        view.showReviewResult(data);

        findByClass(contentEl, "pa-pagelet-suggestion-card__source-chip--interactive").dispatch("click");
        findByClass(contentEl, "pa-pagelet-suggestion-card__related-button").dispatch("click");
        findByClass(contentEl, "pa-pagelet-suggestion-card__btn--research").dispatch("click");
        await Promise.resolve();

        expect(callbacks.openSourceReference).toHaveBeenCalledWith(data.sourceReferences[0]);
        expect(callbacks.openRelatedNote).toHaveBeenCalledWith(
            "[[Related Concept]]",
            "notes/alpha.md",
        );
        expect(callbacks.prepareResearchPrompt).toHaveBeenCalledWith(suggestion);
    });

    it("reports when Chat already has a draft and research prompt is not replaced", async () => {
        const cbs = {
            ...makeCallbacks(),
            prepareResearchPrompt: jest.fn(async () => false),
        };
        const { view, contentEl } = makeView(cbs);
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

    it("showReviewError sets error status and clears review cards", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        view.showReviewError("Provider returned an error", "notes/alpha.md");

        expect(findByClass(contentEl, "pa-pagelet-status__state").textContent)
            .toBe("Provider returned an error");
        expect(findByClass(contentEl, "pa-pagelet-source").textContent)
            .toBe("notes/alpha.md");
        expect(findAllByClass(contentEl, "pa-pagelet-suggestion-card")).toHaveLength(0);
    });

    it("showReviewError works without a source path", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();

        view.showReviewError("Network failure");

        expect(findByClass(contentEl, "pa-pagelet-status__state").textContent)
            .toBe("Network failure");
    });

    it("showReviewEmpty shows no-suggestions status and clears review cards", async () => {
        const { view, contentEl } = makeView();
        await view.onOpen();
        view.showReviewResult(makeReviewData("notes/alpha.md"));

        view.showReviewEmpty("notes/alpha.md");

        expect(findByClass(contentEl, "pa-pagelet-status__state").textContent)
            .toBe("No suggestions worth saving");
        expect(findByClass(contentEl, "pa-pagelet-source").textContent)
            .toBe("notes/alpha.md");
        expect(findAllByClass(contentEl, "pa-pagelet-suggestion-card")).toHaveLength(0);
    });
});
