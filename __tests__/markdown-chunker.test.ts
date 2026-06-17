import { describe, expect, it } from "@jest/globals";

import { createHeadingAwareMarkdownChunks } from "../src/vss/markdown-chunker";

function headingPath(metadata: Record<string, unknown>): string[] {
    return Array.isArray(metadata.headingPath) ? metadata.headingPath as string[] : [];
}

describe("createHeadingAwareMarkdownChunks", () => {
    it("preserves frontmatter and heading path metadata for each chunk", () => {
        const chunks = createHeadingAwareMarkdownChunks({
            path: "notes/project.md",
            markdown: [
                "---",
                "tags: [ai, memory]",
                "aliases: Project Memory",
                "---",
                "# Project",
                "Intro paragraph.",
                "## Decisions",
                "Decision body.",
                "## Open Questions",
                "Question body.",
            ].join("\n"),
            contentHash: "hash-1",
            created: 10,
            lastModified: 20,
            chunkSize: 260,
            chunkOverlap: 0,
        });

        expect(chunks.length).toBeGreaterThanOrEqual(3);
        expect(chunks[0].content).toContain("Frontmatter:\ntags: [ai, memory]");
        expect(chunks[0].content).toContain("aliases: Project Memory");
        expect(chunks[0].metadata.frontmatterIncluded).toBe(true);
        expect(chunks[0].metadata.chunkStrategy).toBe("heading-aware-v2");
        expect(chunks[0].metadata.headingPath).toEqual(["Project"]);
        expect(chunks[0].metadata.startLine).toBe(5);

        const decisions = chunks.find((chunk) =>
            Array.isArray(chunk.metadata.headingPath)
            && chunk.metadata.headingPath.join("/") === "Project/Decisions");
        expect(decisions).toBeDefined();
        expect(decisions?.content).toContain("Decision body.");
        expect(decisions?.metadata.startLine).toBe(7);
    });

    it("does not merge sibling heading sections into the same chunk", () => {
        const chunks = createHeadingAwareMarkdownChunks({
            path: "notes/project.md",
            markdown: [
                "# Root",
                "Overview.",
                "## Alpha",
                "Alpha details.",
                "## Beta",
                "Beta details.",
            ].join("\n"),
            contentHash: "hash-2",
            created: 10,
            lastModified: 20,
            chunkSize: 2000,
            chunkOverlap: 0,
        });

        const alpha = chunks.find((chunk) => headingPath(chunk.metadata).join("/") === "Root/Alpha");
        const beta = chunks.find((chunk) => headingPath(chunk.metadata).join("/") === "Root/Beta");
        expect(alpha?.content).toContain("Alpha details.");
        expect(alpha?.content).not.toContain("Beta details.");
        expect(beta?.content).toContain("Beta details.");
    });

    it("produces overlapping content between consecutive chunks when chunkOverlap > 0", () => {
        // Build a section large enough to force multiple chunks at chunkSize 300
        const lines: string[] = ["# BigSection"];
        for (let i = 0; i < 40; i++) {
            lines.push(`Line ${i}: ${"word ".repeat(12).trim()}.`);
        }
        const chunks = createHeadingAwareMarkdownChunks({
            path: "test.md",
            markdown: lines.join("\n"),
            contentHash: "h-overlap",
            created: 1,
            lastModified: 2,
            chunkSize: 300,
            chunkOverlap: 50,
        });

        expect(chunks.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < chunks.length - 1; i++) {
            const currentLines = chunks[i].content.split("\n");
            const nextContent = chunks[i + 1].content;
            // The tail of chunk N should appear at the start of chunk N+1
            const tail = currentLines[currentLines.length - 1];
            expect(nextContent).toContain(tail);
        }
    });

    it("splits a single very long line into chunks none exceeding chunkSize significantly", () => {
        const longLine = "A".repeat(5000);
        const chunks = createHeadingAwareMarkdownChunks({
            path: "test.md",
            markdown: longLine,
            contentHash: "h-longline",
            created: 1,
            lastModified: 2,
            chunkSize: 1000,
            chunkOverlap: 0,
        });

        expect(chunks.length).toBeGreaterThanOrEqual(2);
        for (const chunk of chunks) {
            // Allow some headroom for frontmatter prefix but should not wildly exceed chunkSize
            expect(chunk.content.length).toBeLessThanOrEqual(1200);
        }
    });

    it("returns an empty array for an empty document", () => {
        const chunks = createHeadingAwareMarkdownChunks({
            path: "test.md",
            markdown: "",
            contentHash: "h-empty",
            created: 1,
            lastModified: 2,
            chunkSize: 260,
            chunkOverlap: 0,
        });

        expect(chunks.length).toBe(0);
    });

    it("returns an empty array for a frontmatter-only document", () => {
        const chunks = createHeadingAwareMarkdownChunks({
            path: "test.md",
            markdown: "---\ntags: [test]\n---",
            contentHash: "h-fm-only",
            created: 1,
            lastModified: 2,
            chunkSize: 260,
            chunkOverlap: 0,
        });

        expect(chunks.length).toBe(0);
    });

    it("produces chunks with empty headingPath for a document without headings", () => {
        const chunks = createHeadingAwareMarkdownChunks({
            path: "test.md",
            markdown: [
                "First paragraph of plain text.",
                "",
                "Second paragraph with more details.",
                "",
                "Third paragraph wrapping up.",
            ].join("\n"),
            contentHash: "h-noheading",
            created: 1,
            lastModified: 2,
            chunkSize: 4000,
            chunkOverlap: 0,
        });

        expect(chunks.length).toBeGreaterThanOrEqual(1);
        for (const chunk of chunks) {
            expect(chunk.metadata.headingPath).toEqual([]);
        }
        expect(chunks[0].content).toContain("First paragraph");
    });
});
