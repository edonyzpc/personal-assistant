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
});
