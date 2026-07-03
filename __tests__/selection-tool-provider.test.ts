import { describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian", () => ({
    MarkdownView: class MarkdownView {},
}));
jest.mock("../src/operations-agent-flags", () => ({
    OPERATIONS_AGENT_RUNTIME_ENABLED: true,
}));

import { REPLACE_SELECTION_TOOL_NAME, SelectionToolProvider } from "../src/ai-services/selection-tool-provider";
import type { AgentCapabilityContext, ProviderLoadContext } from "../src/ai-services/capability-types";

function loadContext(operationsAgentEnabled: boolean): ProviderLoadContext {
    return {
        turnId: "turn-test",
        platform: "desktop",
        settings: { operationsAgentEnabled },
    };
}

function capabilityContext(selection: string): AgentCapabilityContext {
    const replaceSelection = jest.fn();
    return {
        host: {
            app: {
                workspace: {
                    getActiveViewOfType: jest.fn(() => ({
                        getViewType: () => "markdown",
                        file: {
                            path: "notes/current.md",
                            basename: "current",
                        },
                        editor: {
                            getSelection: () => selection,
                            replaceSelection,
                        },
                    })),
                },
            },
            log: jest.fn(),
        } as never,
    };
}

describe("SelectionToolProvider", () => {
    it("does not load replace_selection when Operations Agent mode is disabled", async () => {
        const provider = new SelectionToolProvider();

        const result = await provider.load(loadContext(false));

        expect(result.status).toBe("unavailable");
        expect(result.capabilities).toEqual([]);
    });

    it("loads replace_selection when Operations Agent mode is enabled", async () => {
        const provider = new SelectionToolProvider();

        const result = await provider.load(loadContext(true));

        expect(result.status).toBe("available");
        expect(result.capabilities.map((capability) => capability.name)).toEqual([REPLACE_SELECTION_TOOL_NAME]);
    });

    it("does not write through direct execute before the Write Action Framework is wired", async () => {
        const provider = new SelectionToolProvider();
        const result = await provider.load(loadContext(true));
        const capability = result.capabilities[0]!;
        const context = capabilityContext("selected text");

        const output = await capability.execute({ replacement: "new text" }, context);

        expect(output.status).toBe("failed");
        expect(output.userSafeMessage).toContain("Write Action Framework");
        expect(context.host.app.workspace.getActiveViewOfType).not.toHaveBeenCalled();
    });

    it("rejects malformed direct replacement input before write-action wiring", async () => {
        const provider = new SelectionToolProvider();
        const result = await provider.load(loadContext(true));
        const capability = result.capabilities[0]!;

        const output = await capability.execute({ replacement: "" }, capabilityContext("selected text"));

        expect(output.status).toBe("failed");
        expect(output.userSafeMessage).toContain("non-empty replacement");
    });
});
