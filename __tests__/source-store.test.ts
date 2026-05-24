import { describe, expect, it } from "@jest/globals";

import {
    createSourceDedupKey,
    sanitizeWebSourceUrl,
    SourceStore,
} from "../src/ai-services/source-store";

describe("SourceStore", () => {
    it("keeps web sources out of Memory references", () => {
        const store = new SourceStore([{
            kind: "web-source",
            url: "https://example.com/search?q=pa",
            title: "Example result",
            providerId: "builtin-web",
            capabilityName: "webSearch",
        }]);

        expect(store.query("memory-reference")).toEqual([]);
        expect(store.getCitations()).toEqual([expect.objectContaining({
            kind: "web-source",
            url: "https://example.com/search?q=pa",
        })]);
    });

    it("folds chips across buckets when records share a path dedup key", () => {
        const dedupKey = createSourceDedupKey("notes/project.md");
        const store = new SourceStore([
            {
                kind: "memory-reference",
                path: "notes/project.md",
                title: "Project",
                dedupKey,
            },
            {
                kind: "context-used",
                path: "notes/project.md",
                capabilityName: "get_current_note_context",
                dedupKey,
            },
        ]);

        expect(store.getDisplayChips()).toEqual([{
            dedupKey,
            label: "Project",
            kinds: ["memory-reference", "context-used"],
            citationEligible: true,
            records: [
                expect.objectContaining({ kind: "memory-reference" }),
                expect.objectContaining({ kind: "context-used" }),
            ],
        }]);
    });

    it("sanitizes web URLs and rejects non-web schemes", () => {
        expect(sanitizeWebSourceUrl("javascript:alert(1)")).toBeNull();
        expect(sanitizeWebSourceUrl("file:///private/vault.md")).toBeNull();
        expect(sanitizeWebSourceUrl("https://user:pass@example.com/path?token=SECRET&q=ok#frag")).toBe(
            "https://example.com/path?token=REDACTED&q=ok",
        );
    });

    it("strips HTML and truncates source text", () => {
        const store = new SourceStore([{
            kind: "web-source",
            url: "https://example.com/article",
            title: "<b>Title</b>",
            snippet: `<p>${"x".repeat(700)}</p>`,
        }]);

        const [record] = store.query("web-source");
        expect(record.title).toBe("Title");
        expect(record.snippet?.length).toBeLessThanOrEqual(500);
        expect(record.snippet?.endsWith("...")).toBe(true);
    });
});
