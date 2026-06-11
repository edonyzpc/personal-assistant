/* Copyright 2023 edonyzpc */

/**
 * Regression tests for {@link getPageletOverlayRoot}.
 *
 * The runtime requires three guarantees:
 *   1. Prefer `app.workspace.containerEl` when it is a real HTMLElement.
 *   2. Fall back to `.app-container` if workspace isn't ready yet.
 *   3. Fall back to `document.body` only as a last resort.
 *
 * Jest runs under a node environment here (no jsdom dependency in the
 * project), so we install the minimum DOM globals required by the
 * implementation BEFORE importing it. This lets us drive the fallback
 * chain deterministically without pulling in a heavy environment.
 */

import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

// Minimal HTMLElement stand-in. The implementation uses
// `instanceof HTMLElement`, so we only need a constructor whose
// instances pass that check.
class FakeHTMLElement {}

let querySelectorImpl: (selector: string) => unknown = () => null;
const fakeBody = new FakeHTMLElement();

const globalRecord = globalThis as unknown as Record<string, unknown>;
const originalHTMLElement = globalRecord.HTMLElement;
const originalDocument = globalRecord.document;

globalRecord.HTMLElement = FakeHTMLElement;
globalRecord.document = {
    get body() {
        return fakeBody;
    },
    querySelector: (selector: string) => querySelectorImpl(selector),
};

// Import AFTER globals are in place so the module's
// `instanceof HTMLElement` references resolve to FakeHTMLElement.
import type { App } from "obsidian";
import { getPageletOverlayRoot } from "../src/pagelet/overlay-root";

const makeApp = (containerEl?: unknown): App =>
    ({
        workspace: { containerEl },
    }) as unknown as App;

describe("getPageletOverlayRoot", () => {
    beforeEach(() => {
        querySelectorImpl = () => null;
    });

    afterAll(() => {
        globalRecord.HTMLElement = originalHTMLElement;
        globalRecord.document = originalDocument;
    });

    it("returns workspace.containerEl when it is a real HTMLElement", () => {
        const ws = new FakeHTMLElement();
        expect(getPageletOverlayRoot(makeApp(ws))).toBe(ws);
    });

    it("falls back to .app-container when workspace.containerEl is missing", () => {
        const appContainer = new FakeHTMLElement();
        querySelectorImpl = (sel) =>
            sel === ".app-container" ? appContainer : null;
        expect(getPageletOverlayRoot(makeApp(undefined))).toBe(appContainer);
    });

    it("falls back to document.body when neither is present", () => {
        expect(getPageletOverlayRoot(makeApp(undefined))).toBe(fakeBody);
    });

    it("ignores workspace.containerEl when it is not an HTMLElement", () => {
        // A leaked stub from older mocks would have shape but not type;
        // the guard must reject it and continue down the fallback chain.
        const notAnElement = { tagName: "DIV" };
        const appContainer = new FakeHTMLElement();
        querySelectorImpl = (sel) =>
            sel === ".app-container" ? appContainer : null;
        expect(getPageletOverlayRoot(makeApp(notAnElement))).toBe(
            appContainer,
        );
    });

    it("falls back to body when .app-container exists but is not an HTMLElement", () => {
        querySelectorImpl = () => ({ tagName: "DIV" });
        expect(getPageletOverlayRoot(makeApp(undefined))).toBe(fakeBody);
    });
});
