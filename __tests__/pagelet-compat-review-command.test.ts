/* Copyright 2023 edonyzpc */

import { describe, expect, it, jest } from "@jest/globals";

import {
    PAGELET_REVIEW_CURRENT_COMMAND_ID,
    registerPageletReviewCurrentCommand,
} from "../src/pagelet/compat/review-command";
import type {
    PageletCommandDefinition,
    PageletCommandHost,
} from "../src/pagelet/compat/focus-command";

interface RecordingCommandHost extends PageletCommandHost {
    registered: PageletCommandDefinition[];
}

function makeCommandHost(): RecordingCommandHost {
    const registered: PageletCommandDefinition[] = [];
    return {
        registered,
        addCommand(definition) {
            registered.push(definition);
            return null;
        },
    };
}

describe("registerPageletReviewCurrentCommand", () => {
    it("uses the stable Pagelet review command ID", () => {
        expect(PAGELET_REVIEW_CURRENT_COMMAND_ID).toBe("pa-pagelet:review-current");
    });

    it("registers a command-palette entry without a default hotkey", () => {
        const host = makeCommandHost();
        registerPageletReviewCurrentCommand(host, {
            onReviewCurrent: jest.fn<() => void>(),
        });

        expect(host.registered).toHaveLength(1);
        expect(host.registered[0].id).toBe(PAGELET_REVIEW_CURRENT_COMMAND_ID);
        expect(host.registered[0].name).toBe("Pagelet: Review current note");
        expect(host.registered[0].hotkeys).toBeUndefined();
    });

    it("accepts localized display names", () => {
        const host = makeCommandHost();
        registerPageletReviewCurrentCommand(host, {
            name: "拾页：审阅当前笔记",
            onReviewCurrent: jest.fn<() => void>(),
        });

        expect(host.registered[0].name).toBe("拾页：审阅当前笔记");
    });

    it("can register an explicit hotkey list when the caller provides one", () => {
        const host = makeCommandHost();
        const hotkeys = [{ modifiers: ["Mod", "Shift"] as const, key: "P" }];
        registerPageletReviewCurrentCommand(host, {
            hotkeys,
            onReviewCurrent: jest.fn<() => void>(),
        });

        expect(host.registered[0].hotkeys).toEqual(hotkeys);
    });

    it("invokes the supplied review callback", () => {
        const host = makeCommandHost();
        const onReviewCurrent = jest.fn<() => void>();
        registerPageletReviewCurrentCommand(host, { onReviewCurrent });

        host.registered[0].callback();

        expect(onReviewCurrent).toHaveBeenCalledTimes(1);
    });

    it("does not await async callbacks in the Obsidian command tick", async () => {
        const host = makeCommandHost();
        const onReviewCurrent = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
        registerPageletReviewCurrentCommand(host, { onReviewCurrent });

        expect(() => host.registered[0].callback()).not.toThrow();
        await Promise.resolve();

        expect(onReviewCurrent).toHaveBeenCalledTimes(1);
    });
});
