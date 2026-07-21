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
                listeners.set(type, [...(listeners.get(type) ?? []), listener]);
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
    requestPageletReviewHighRiskDecision,
    type PageletReviewHighRiskChoice,
    type PageletReviewHighRiskSummary,
} from "../src/pagelet/ReviewHighRiskModal";

const summary: PageletReviewHighRiskSummary = {
    scopeLabel: "Last 7 days · 3 notes",
    includedSourceCount: 3,
    skippedSourceCount: 2,
    provider: "OpenAI",
    model: "gpt-4o-mini",
    endpoint: "https://api.openai.com/v1",
    hourlyCap: 10,
    dailyCap: 100,
};

function allElements(root: MockElement): MockElement[] {
    return [root, ...root.children.flatMap(allElements)];
}

function openedModal(): MockModalInstance {
    expect(mockModalInstances).toHaveLength(1);
    return mockModalInstances[0];
}

describe("requestPageletReviewHighRiskDecision", () => {
    beforeEach(() => {
        mockModalInstances.length = 0;
    });

    it("discloses multi-note scope, provider destination, bounded cost, and no source mutation", () => {
        void requestPageletReviewHighRiskDecision({} as App, summary, "en");
        const text = allElements(openedModal().contentEl)
            .map((element) => element.textContent)
            .filter(Boolean);

        expect(text).toEqual(expect.arrayContaining([
            "Review multiple notes with AI?",
            "This Review includes more than one allowed note. Confirm this scope before any AI call or usage is reserved.",
            "Current scope: Last 7 days · 3 notes. 3 note(s) included; 2 selected note(s) skipped by your data boundary or input limit.",
            "AI provider: OpenAI · gpt-4o-mini. Endpoint: https://api.openai.com/v1. Included note excerpts may be sent there.",
            "Bounded usage: at most 10 foreground call(s) per hour and 100 per day. Calls may use AI credits.",
            "Your source notes are not modified. You can adjust the Review scope before running again.",
            "You can turn Review off in Settings at any time.",
        ]));
    });

    it.each<[string, PageletReviewHighRiskChoice]>([
        ["Run", "run"],
        ["Adjust scope", "adjust"],
        ["Cancel", "cancel"],
    ])("resolves %s to %s", async (label, expectedChoice) => {
        const choice = requestPageletReviewHighRiskDecision({} as App, summary, "en");
        const button = allElements(openedModal().contentEl)
            .find((element) => element.tagName === "button" && element.textContent === label);

        expect(button).toBeDefined();
        button?.dispatchEvent("click");

        await expect(choice).resolves.toBe(expectedChoice);
    });

    it("treats passive close as closed and never as Run", async () => {
        const choice = requestPageletReviewHighRiskDecision({} as App, summary, "en");

        openedModal().close();

        await expect(choice).resolves.toBe("closed");
    });

    it("closes and resolves safely when the provider deadline aborts", async () => {
        const controller = new AbortController();
        const choice = requestPageletReviewHighRiskDecision(
            {} as App,
            summary,
            "en",
            controller.signal,
        );
        const modal = openedModal();

        controller.abort();

        await expect(choice).resolves.toBe("closed");
        expect(modal.contentEl.children).toEqual([]);
    });
});
