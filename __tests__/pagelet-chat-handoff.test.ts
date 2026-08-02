import { describe, expect, it } from "@jest/globals";

import { createPageletChatHandoffContext } from "../src/ai-services/pagelet-handoff";

describe("Pagelet Chat handoff envelope", () => {
    it("keeps the complete visible evidence and strips unexpected runtime fields", () => {
        const body = `# Insight\n\n${"Complete source-backed argument. ".repeat(30)}`;
        const context = createPageletChatHandoffContext({
            version: 1,
            id: "cache-hash-1",
            body,
            anchor: {
                path: "projects/anchor.md",
                mtime: 10,
                size: 100,
                contentHash: "anchor-hash",
                hiddenPrompt: "must not survive",
            },
            sources: [{
                path: "research/source.md",
                mtime: 11,
                size: 200,
                contentHash: "source-hash",
                transcript: "must not survive",
            }],
            sourceRefs: [{ path: "research/source.md", title: "Source", toolPrompt: "must not survive" }],
            webUrls: ["https://example.com/evidence"],
            whyNow: ["The anchor changed."],
            triggerReason: "explicit",
            preparedAt: 1234,
            pipelineVersion: "pagelet-deep-discover-v1",
            metrics: { modelTurns: 2 },
        } as never);

        expect(context.body).toBe(body);
        expect(context.sources).toHaveLength(1);
        expect(context.sourceRefs).toEqual([{ path: "research/source.md", title: "Source" }]);
        expect(JSON.stringify(context)).not.toContain("hiddenPrompt");
        expect(JSON.stringify(context)).not.toContain("transcript");
        expect(JSON.stringify(context)).not.toContain("toolPrompt");
        expect(JSON.stringify(context)).not.toContain("metrics");
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(context.sources)).toBe(true);
        expect(Object.isFrozen(context.sources[0])).toBe(true);
    });
});
