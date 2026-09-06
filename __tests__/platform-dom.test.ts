/* Copyright 2023 edonyzpc */

import { describe, expect, it, jest } from "@jest/globals";
import type { Vault } from "obsidian";

import { createChatHistoryStore } from "../src/chat/chat-history-store";
import { eventPathContainsSelector, getPlatformIndexedDB } from "../src/platform-dom";

function replaceGlobal(name: string, value: unknown): () => void {
    const prior = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    return () => {
        if (prior) Object.defineProperty(globalThis, name, prior);
        else Reflect.deleteProperty(globalThis, name);
    };
}

describe("platform IndexedDB lifetime", () => {
    it("keeps a production store usable after its temporary active Settings window closes", async () => {
        const close = jest.fn();
        const request = { result: { close }, onsuccess: null as null | (() => void) };
        const stableFactory = {
            open: jest.fn(() => {
                queueMicrotask(() => request.onsuccess?.());
                return request;
            }),
        };
        const settingsWindow = {
            closed: false,
            indexedDB: { open: jest.fn(() => settingsWindow.closed ? null : request) },
        };
        const restores = [
            replaceGlobal("self", { indexedDB: stableFactory }),
            replaceGlobal("activeWindow", settingsWindow),
        ];
        const vault = { adapter: { getBasePath: () => "/b129-platform-test" }, configDir: ".obsidian" } as unknown as Vault;
        const store = createChatHistoryStore(vault, "stable-vault", "personal-assistant");
        try {
            settingsWindow.closed = true;
            await expect(store.initialize()).resolves.toBeUndefined();
            expect(stableFactory.open).toHaveBeenCalledTimes(1);
            expect(settingsWindow.indexedDB.open).not.toHaveBeenCalled();
            expect(getPlatformIndexedDB()).toBe(stableFactory);
        } finally {
            await store.dispose();
            for (const restore of restores.reverse()) restore();
        }
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("does not borrow a temporary window's storage when the plugin realm has none", () => {
        const temporaryFactory = { open: jest.fn() };
        const restores = [
            replaceGlobal("self", {}),
            replaceGlobal("activeWindow", { indexedDB: temporaryFactory }),
        ];
        try { expect(getPlatformIndexedDB()).toBeUndefined(); }
        finally { for (const restore of restores.reverse()) restore(); }
    });

    it("uses its own window when self is unavailable", () => {
        const stableFactory = { open: jest.fn() };
        const restores = [
            replaceGlobal("self", undefined),
            replaceGlobal("window", { indexedDB: stableFactory }),
            replaceGlobal("activeWindow", { indexedDB: { open: jest.fn() } }),
        ];
        try { expect(getPlatformIndexedDB()).toBe(stableFactory); }
        finally { for (const restore of restores.reverse()) restore(); }
    });
});

describe("platform DOM event helpers", () => {
    it("detects selectors from composed paths after modal DOM removal", () => {
        const modalButton = {
            matches: jest.fn(() => false),
            closest: jest.fn((selector: string) => selector === ".modal-container, .modal" ? ({} as Element) : null),
        };
        const event = {
            composedPath: () => [modalButton],
        } as unknown as Event;

        expect(eventPathContainsSelector(event, ".modal-container, .modal")).toBe(true);
    });

    it("falls back to the event target when composedPath is unavailable", () => {
        const target = {
            matches: jest.fn((selector: string) => selector === ".modal-container, .modal"),
            closest: jest.fn(() => null),
        };
        const event = { target } as unknown as Event;

        expect(eventPathContainsSelector(event, ".modal-container, .modal")).toBe(true);
    });
});
