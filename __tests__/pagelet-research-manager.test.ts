/* Copyright 2023 edonyzpc */

import { describe, expect, it, jest } from "@jest/globals";

import { VIEW_TYPE_LLM } from "../src/chat/view-type";
import { ResearchManager } from "../src/pagelet/research";

jest.mock("obsidian", () => ({
    Notice: jest.fn(),
}));

describe("ResearchManager", () => {
    it("looks up the registered Chat view type before prefilling research", async () => {
        const prefillComposer = jest.fn<(prompt: string) => boolean>(() => true);
        const getLeavesOfType = jest.fn<(viewType: string) => Array<{
            view: { prefillComposer: (prompt: string) => boolean };
        }>>(() => [{ view: { prefillComposer } }]);
        const revealLeaf = jest.fn();
        const onResearchComplete = jest.fn();
        const manager = new ResearchManager(
            { workspace: { getLeavesOfType, revealLeaf } } as never,
            {
                onResearchComplete,
                onResearchError: jest.fn(),
            },
        );

        await manager.research({
            findingText: "Needs source evidence.",
            sourceFile: "notes/source.md",
            sourceTitle: "Source",
        });

        expect(getLeavesOfType).toHaveBeenCalledWith(VIEW_TYPE_LLM);
        expect(revealLeaf).toHaveBeenCalledTimes(1);
        expect(prefillComposer).toHaveBeenCalledWith(expect.stringContaining("Needs source evidence."));
        expect(onResearchComplete).toHaveBeenCalledTimes(1);
    });

    it("creates a Chat leaf when none exists", async () => {
        const prefillComposer = jest.fn<(prompt: string) => boolean>(() => true);
        const setViewState = jest.fn<(state: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
        const newLeaf = { view: { prefillComposer }, setViewState };
        const getLeavesOfType = jest.fn<(t: string) => Array<unknown>>(() => []);
        const getRightLeaf = jest.fn<(split: boolean) => typeof newLeaf>(() => newLeaf);
        const revealLeaf = jest.fn();
        const onResearchComplete = jest.fn();
        const manager = new ResearchManager(
            { workspace: { getLeavesOfType, getRightLeaf, revealLeaf } } as never,
            {
                onResearchComplete,
                onResearchError: jest.fn(),
            },
        );

        await manager.research({
            findingText: "Missing link target.",
            sourceFile: "notes/test.md",
        });

        expect(getRightLeaf).toHaveBeenCalledWith(false);
        expect(setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_LLM, active: true });
        expect(revealLeaf).toHaveBeenCalledTimes(1);
        expect(prefillComposer).toHaveBeenCalledWith(expect.stringContaining("Missing link target."));
        expect(onResearchComplete).toHaveBeenCalledTimes(1);
    });
});
