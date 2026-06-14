/* Copyright 2023 edonyzpc */

import { describe, expect, it, jest } from "@jest/globals";

import { eventPathContainsSelector } from "../src/platform-dom";

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
