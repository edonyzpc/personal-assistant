import {
    prepareShareCardMarkdown,
    serializePageletFindings,
} from "../src/share-card/share-card-markdown";

describe("Share Card Markdown preparation", () => {
    it("normalizes CRLF without stripping leading thematic/frontmatter-like text", () => {
        const input = "---\r\ntitle: Kept\r\n---\r\n\r\n# Heading\r\n";

        const prepared = prepareShareCardMarkdown(input);

        expect(prepared.markdown).toBe("---\ntitle: Kept\n---\n\n# Heading\n");
        expect(prepared.blocks).toEqual(["---\ntitle: Kept\n---", "# Heading"]);
    });

    it("preserves explicit Markdown, wiki, img, SVG and Canvas visual syntax", () => {
        const input = [
            "Before ![sunset](data:image/png;base64,AA) after.",
            "![reference][chart]",
            "[chart]: data:image/webp;base64,BB",
            "![[assets/chart.png|Quarterly chart]]",
            "<img src=\"data:image/jpeg;base64,CC\" alt=\"Private chart\">",
            "<svg viewBox=\"0 0 10 10\"><path d=\"M0 0L10 10\" /></svg>",
            "<canvas width=\"10\" height=\"10\"></canvas>",
        ].join("\n");

        expect(prepareShareCardMarkdown(input).markdown).toBe(input);
    });

    it("keeps fenced code atomic while omitting empty separator blocks", () => {
        const prepared = prepareShareCardMarkdown([
            "Intro",
            "",
            "```ts",
            "const first = 1;",
            "",
            "const second = 2;",
            "```",
            "",
            "After",
        ].join("\n"));

        expect(prepared.blocks).toEqual([
            "Intro",
            "```\nconst first = 1;\n\nconst second = 2;\n```",
            "After",
        ]);
    });

    it.each(["svg", "canvas", "picture", "figure"])(
        "keeps a paired raw %s visual atomic across blank lines",
        (tagName) => {
            const input = [
                "Before",
                "",
                `<${tagName}>`,
                "first visual child",
                "",
                "second visual child",
                `</${tagName}>`,
                "",
                "After",
            ].join("\n");

            expect(prepareShareCardMarkdown(input).blocks).toEqual([
                "Before",
                [
                    `<${tagName}>`,
                    "first visual child",
                    "",
                    "second visual child",
                    `</${tagName}>`,
                ].join("\n"),
                "After",
            ]);
        },
    );

    it("preserves media-looking literals while disabling executable fence processors", () => {
        const prepared = prepareShareCardMarkdown([
            "```dataviewjs",
            "dv.list(['![literal](https://example.com/not-loaded.png)']);",
            "<iframe src=\"https://example.com/literal\"></iframe>",
            "```",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "```",
            "dv.list(['![literal](https://example.com/not-loaded.png)']);",
            "<iframe src=\"https://example.com/literal\"></iframe>",
            "```",
        ].join("\n"));
    });

    it("keeps only Mermaid as an executable top-level fenced processor", () => {
        const prepared = prepareShareCardMarkdown([
            "```dataviewjs",
            "dv.pages()",
            "```",
            "",
            "~~~mermaid",
            "graph TD",
            "~~~",
            "",
            "```MERMAID",
            "graph LR",
            "```",
            "",
            "```mermaid extra",
            "graph BT",
            "```",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "```",
            "dv.pages()",
            "```",
            "",
            "~~~mermaid",
            "graph TD",
            "~~~",
            "",
            "```mermaid",
            "graph LR",
            "```",
            "",
            "```",
            "graph BT",
            "```",
        ].join("\n"));
    });

    it("applies the processor allowlist inside blockquote and list containers", () => {
        const prepared = prepareShareCardMarkdown([
            "> ```dataviewjs",
            "> dv.pages()",
            "> ```",
            "> - ~~~mermaid",
            ">   graph TD",
            ">   ~~~",
            "- ```query",
            "  tag:#private",
            "  ```",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "> ```",
            "> dv.pages()",
            "> ```",
            "> - ~~~mermaid",
            ">   graph TD",
            ">   ~~~",
            "- ```",
            "  tag:#private",
            "  ```",
        ].join("\n"));
    });

    it("inherits list context for a four-space continuation fence", () => {
        const prepared = prepareShareCardMarkdown([
            "- Item",
            "    ```dataviewjs",
            "    dv.pages()",
            "    ```",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "- Item",
            "    ```",
            "    dv.pages()",
            "    ```",
        ].join("\n"));
    });

    it("keeps list context across a lazy paragraph continuation", () => {
        const prepared = prepareShareCardMarkdown([
            "> 10. Item",
            "lazy continuation",
            ">     ```dataviewjs",
            ">     dv.pages()",
            ">     ```",
        ].join("\n"));

        expect(prepared.markdown).toContain(">     ```\n>     dv.pages()");
        expect(prepared.markdown).not.toContain("dataviewjs");
    });

    it("does not let a non-one ordered marker interrupt an open paragraph", () => {
        const input = [
            "Paragraph stays open",
            "2. ~~~dataviewjs",
            "   ![visual](data:image/png;base64,AA)",
            "   ~~~",
        ].join("\n");

        expect(prepareShareCardMarkdown(input).markdown).toBe(input);
    });

    it("preserves media-looking literals throughout top-level and nested indented code", () => {
        const inputs = [
            [
                "    <img src=\"https://example.com/literal.png\">",
                "\t![literal](https://example.com/literal.png)",
            ].join("\n"),
            [
                ">     <svg><image href=\"https://example.com/literal.png\" /></svg>",
                ">     ![literal](https://example.com/literal.png)",
            ].join("\n"),
        ];

        for (const input of inputs) expect(prepareShareCardMarkdown(input).markdown).toBe(input);
    });

    it("does not reinterpret an invalid backtick info string as a fence", () => {
        const input = [
            "```bad`info",
            "    <img src=\"data:image/png;base64,AA\" alt=\"Private\">",
        ].join("\n");

        expect(prepareShareCardMarkdown(input).markdown).toBe(input);
    });

    it("does not rewrite media-looking literals inside inline code", () => {
        const input = [
            "Use `![literal](https://example.com/code.png)` as the example.",
            "Outside ![chart](data:image/png;base64,AA).",
        ].join("\n");

        expect(prepareShareCardMarkdown(input).markdown).toBe(input);
    });
});

describe("serializePageletFindings", () => {
    it("keeps only trimmed, unique approved text in finding order", () => {
        const content = serializePageletFindings([
            {
                title: "  First finding  ",
                description: "Same detail",
                insightText: " Same detail ",
                sourceFile: "Private.md",
                diagnostics: { partial: true },
            },
            {
                title: "First finding",
                description: "  Second detail ",
                insightText: "",
                actionStatus: { label: "Hidden action" },
            },
            { title: " ", description: "", insightText: undefined },
        ]);

        expect(content).toBe([
            "## First finding\n\nSame detail",
            "## First finding\n\nSecond detail",
        ].join("\n\n---\n\n"));
        expect(content).not.toContain("Private.md");
        expect(content).not.toContain("Hidden action");
    });
});
