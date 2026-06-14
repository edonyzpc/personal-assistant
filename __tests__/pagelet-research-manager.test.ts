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
        const onResearchComplete = jest.fn();
        const manager = new ResearchManager(
            { workspace: { getLeavesOfType } } as never,
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
        expect(prefillComposer).toHaveBeenCalledWith(expect.stringContaining("Needs source evidence."));
        expect(onResearchComplete).toHaveBeenCalledTimes(1);
    });
});
