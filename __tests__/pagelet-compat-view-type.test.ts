/* Copyright 2023 edonyzpc */

/**
 * Track B · B5 unit tests for view-type gating (R1).
 *
 * Coverage matrix:
 *  - `isPageletEligibleView`: pass / fail decisions for every plausible
 *    Obsidian view-type string + defensive null/undefined/throw cases.
 *  - `getActiveMarkdownView`: returns the view when active leaf is
 *    Markdown; returns null when active leaf is Canvas/Excalidraw/etc.;
 *    returns null when getActiveViewOfType returns null.
 */

import { describe, expect, it, jest } from "@jest/globals";

import {
    PAGELET_ELIGIBLE_VIEW_TYPE,
    getActiveMarkdownView,
    isPageletEligibleView,
} from "../src/pagelet/compat/view-type";

describe("PAGELET_ELIGIBLE_VIEW_TYPE", () => {
    it("is the literal Obsidian markdown view-type string", () => {
        expect(PAGELET_ELIGIBLE_VIEW_TYPE).toBe("markdown");
    });
});

describe("isPageletEligibleView", () => {
    it("returns true when getViewType() === 'markdown'", () => {
        expect(isPageletEligibleView({ getViewType: () => "markdown" })).toBe(true);
    });

    it.each([
        "canvas",
        "excalidraw",
        "kanban",
        "pdf",
        "image",
        "db-folder",
        "empty",
        "audio",
        "video",
        // Adjacent strings that look close but are NOT markdown.
        "markdown-readable",
        "MARKDOWN",
        " markdown",
    ])("returns false for non-eligible view-type %s", (viewType) => {
        expect(isPageletEligibleView({ getViewType: () => viewType })).toBe(false);
    });

    it("returns false for null / undefined inputs (no active leaf)", () => {
        expect(isPageletEligibleView(null)).toBe(false);
        expect(isPageletEligibleView(undefined)).toBe(false);
    });

    it("returns false when the view lacks a getViewType accessor", () => {
        expect(isPageletEligibleView({} as unknown as { getViewType(): string })).toBe(false);
    });

    it("returns false when getViewType throws", () => {
        const view = {
            getViewType: (): string => {
                throw new Error("third-party view extension blew up");
            },
        };
        expect(isPageletEligibleView(view)).toBe(false);
    });

    it("returns false when getViewType returns a non-string value", () => {
        expect(
            isPageletEligibleView({ getViewType: () => 42 as unknown as string }),
        ).toBe(false);
        expect(
            isPageletEligibleView({ getViewType: () => null as unknown as string }),
        ).toBe(false);
    });
});

describe("getActiveMarkdownView", () => {
    // A stand-in for the Obsidian MarkdownView constructor — only the
    // identity matters, since getActiveViewOfType is mocked.
    class MarkdownViewStub {
        getViewType() {
            return "markdown";
        }
    }

    it("returns the active view when it is a Markdown view", () => {
        const activeView = new MarkdownViewStub();
        const workspace = {
            getActiveViewOfType: jest.fn(() => activeView as unknown),
        } as unknown as Parameters<typeof getActiveMarkdownView>[0];
        const result = getActiveMarkdownView(
            workspace,
            MarkdownViewStub as unknown as Parameters<typeof getActiveMarkdownView>[1],
        );
        expect(result).toBe(activeView);
    });

    it("returns null when getActiveViewOfType returns null", () => {
        const workspace = {
            getActiveViewOfType: jest.fn(() => null),
        } as unknown as Parameters<typeof getActiveMarkdownView>[0];
        const result = getActiveMarkdownView(
            workspace,
            MarkdownViewStub as unknown as Parameters<typeof getActiveMarkdownView>[1],
        );
        expect(result).toBeNull();
    });

    it("returns null when the returned view has a non-markdown view-type", () => {
        // Some unusual Obsidian shims may return an object that is
        // structurally a MarkdownView but reports a different view-type
        // (e.g. an alternative reader mode). We still gate.
        const fakeView = {
            getViewType: () => "markdown-source-only",
        };
        const workspace = {
            getActiveViewOfType: jest.fn(() => fakeView as unknown),
        } as unknown as Parameters<typeof getActiveMarkdownView>[0];
        const result = getActiveMarkdownView(
            workspace,
            MarkdownViewStub as unknown as Parameters<typeof getActiveMarkdownView>[1],
        );
        expect(result).toBeNull();
    });
});
