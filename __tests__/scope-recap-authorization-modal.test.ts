import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { App } from "obsidian";

type MockElement = {
    tagName: string;
    textContent: string;
    children: MockElement[];
    empty(): void;
    addClass(className: string): void;
    createEl(tagName: string, options?: { text?: string; cls?: string }): MockElement;
    createDiv(options?: { text?: string; cls?: string }): MockElement;
    addEventListener(type: string, listener: () => void): void;
    dispatchEvent(type: string): void;
};

type MockModalInstance = {
    contentEl: MockElement;
    close(): void;
};

const mockModalInstances: MockModalInstance[] = [];

jest.mock("obsidian", () => {
    const createMockElement = (
        tagName: string,
        options?: { text?: string; cls?: string },
    ): MockElement => {
        const listeners = new Map<string, Array<() => void>>();
        const element: MockElement = {
            tagName,
            textContent: options?.text ?? "",
            children: [],
            empty: jest.fn(() => {
                element.textContent = "";
                element.children = [];
            }),
            addClass: jest.fn(),
            createEl: jest.fn((childTagName: string, childOptions?: { text?: string; cls?: string }) => {
                const child = createMockElement(childTagName, childOptions);
                element.children.push(child);
                return child;
            }),
            createDiv: jest.fn((childOptions?: { text?: string; cls?: string }) => (
                element.createEl("div", childOptions)
            )),
            addEventListener: jest.fn((type: string, listener: () => void) => {
                const current = listeners.get(type) ?? [];
                current.push(listener);
                listeners.set(type, current);
            }),
            dispatchEvent: jest.fn((type: string) => {
                for (const listener of listeners.get(type) ?? []) listener();
            }),
        };
        return element;
    };

    return {
        Modal: class {
            contentEl = createMockElement("div");

            constructor(_app: unknown) {
                mockModalInstances.push(this);
            }

            open(): void {
                (this as { onOpen?: () => void }).onOpen?.();
            }

            close(): void {
                (this as { onClose?: () => void }).onClose?.();
            }
        },
    };
});

import {
    requestScopeRecapAuthorization,
    type ScopeRecapAuthorizationChoice,
    type ScopeRecapAuthorizationSummary,
} from "../src/pagelet/recap/ScopeRecapAuthorizationModal";

const summary: ScopeRecapAuthorizationSummary = {
    scopeLabel: "Last 7 days",
    includedSourceCount: 12,
    skippedSourceCount: 3,
    provider: "DashScope",
    model: "qwen3.7-max-preview",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    hourlyCap: 2,
    dailyCap: 10,
};

function allElements(root: MockElement): MockElement[] {
    return [root, ...root.children.flatMap(allElements)];
}

function openedModal(): MockModalInstance {
    expect(mockModalInstances).toHaveLength(1);
    return mockModalInstances[0];
}

describe("requestScopeRecapAuthorization", () => {
    beforeEach(() => {
        mockModalInstances.length = 0;
    });

    it("discloses scope, provider destination, data sending, bounded cost, and local safety", () => {
        requestScopeRecapAuthorization({} as App, summary, "en");
        const modal = openedModal();
        const text = allElements(modal.contentEl)
            .map((element) => element.textContent)
            .filter(Boolean);

        expect(text).toEqual(expect.arrayContaining([
            "Prepare useful Recaps before you open them?",
            "Pagelet can quietly prepare a source-backed Recap for the scope you are working in, so opening it does not make you wait.",
            "Current scope: Last 7 days. 12 note(s) included; 3 skipped by your data boundary.",
            "AI provider: DashScope · qwen3.7-max-preview. Endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1. Included note text may be sent there.",
            "Bounded usage: at most 2 preparation call(s) per hour and 10 per day. Calls may use AI credits.",
            "Your source notes are never modified. Prepared Recaps are local derived cache and can be cleared.",
        ]));
    });

    it.each<[string, ScopeRecapAuthorizationChoice]>([
        ["Run", "run"],
        ["Adjust settings", "adjust"],
        ["Cancel", "cancel"],
    ])("resolves %s to %s", async (label, expectedChoice) => {
        const choice = requestScopeRecapAuthorization({} as App, summary, "en");
        const button = allElements(openedModal().contentEl)
            .find((element) => element.tagName === "button" && element.textContent === label);

        expect(button).toBeDefined();
        button?.dispatchEvent("click");

        await expect(choice).resolves.toBe(expectedChoice);
    });

    it("resolves a direct close without a selection to adjust", async () => {
        const choice = requestScopeRecapAuthorization({} as App, summary, "en");

        openedModal().close();

        await expect(choice).resolves.toBe("adjust");
    });
});
