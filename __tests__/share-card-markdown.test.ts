import {
    prepareShareCardMarkdown,
    serializePageletFindings,
} from "../src/share-card/share-card-markdown";
import { ShareCardPaginationError } from "../src/share-card/share-card-paginator";

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

describe("Share Card footnote projection", () => {
    it("numbers first references across the batch and appends every definition once after the body", () => {
        const input = [
            "[^orphan-first]: Unreferenced first definition.",
            "",
            "[^alpha]: Alpha footnote detail.",
            "",
            "First body cites [^beta], then [^alpha].",
            "",
            "Second body repeats [^beta].",
            "",
            "[^beta]: Beta footnote detail.",
            "",
            "[^orphan-last]: Unreferenced final definition.",
            "",
            "Final body marker.",
        ].join("\n");

        const { markdown } = prepareShareCardMarkdown(input);
        const bodyEnd = markdown.indexOf("Final body marker.");
        const body = markdown.slice(0, bodyEnd + "Final body marker.".length);

        expect(body).toContain("First body cites \\[1\\], then \\[2\\].");
        expect(body).toContain("Second body repeats \\[1\\].");
        const notes = [
            [1, "Beta footnote detail."],
            [2, "Alpha footnote detail."],
            [3, "Unreferenced first definition."],
            [4, "Unreferenced final definition."],
        ] as const;
        let previousNoteIndex = bodyEnd;
        for (const [number, text] of notes) {
            const noteIndex = markdown.indexOf(text);
            expect(noteIndex).toBeGreaterThan(previousNoteIndex);
            expect(markdown.split(text)).toHaveLength(2);
            const beforeText = markdown.slice(previousNoteIndex, noteIndex);
            expect(beforeText).toContain(`\\[${number}\\]`);
            previousNoteIndex = noteIndex;
        }
        expect(markdown).not.toContain("[^alpha]");
        expect(markdown).not.toContain("[^beta]");
    });

    it("retains multiline Markdown after removing only the footnote continuation indentation", () => {
        const { markdown } = prepareShareCardMarkdown([
            "Body has a detailed note[^detail].",
            "",
            "[^detail]: First **bold** paragraph.",
            "    Continuation has *emphasis* and [a link](https://example.com/detail).",
            "",
            "    - list item one",
            "    - list item two",
            "",
            "\t> Quoted continuation.",
            "",
            "    ```",
            "    const literal = '[^inside-code]';",
            "    ```",
            "",
            "After all body content.",
        ].join("\n"));

        expect(markdown).toContain("Body has a detailed note\\[1\\].");
        expect(markdown.indexOf("First **bold** paragraph."))
            .toBeGreaterThan(markdown.indexOf("After all body content."));
        expect(markdown).toContain("First **bold** paragraph.\nContinuation has *emphasis*");
        expect(markdown).toContain("[a link](https://example.com/detail)");
        expect(markdown).toContain("- list item one\n- list item two");
        expect(markdown).toContain("> Quoted continuation.");
        expect(markdown).toContain("```\nconst literal = '[^inside-code]';\n```");
        expect(markdown.split("First **bold** paragraph.")).toHaveLength(2);
    });

    it.each([
        ["fenced code", "```\n[^real]: This is a literal definition.\nUse [^real] literally.\n```"],
        ["inline code", "Use `[^real]` and `[^real]: literal definition` as examples."],
        ["indented code", "    [^real]: This is a literal definition.\n    Use [^real] literally."],
        ["escaped reference", "Escaped \\[^real] is literal."],
        ["raw HTML block", "<div>\n[^real]: This stays HTML content.\n<span>[^real]</span>\n</div>"],
        ["inline HTML", "<span title=\"[^real]\">[^real]</span>"],
        ["link destination", "[a link](https://example.com/path/[^real])"],
        ["reference destination", "[destination]: https://example.com/path/[^real]"],
    ])("does not rewrite footnote-looking text in %s", (_label, literal) => {
        const { markdown } = prepareShareCardMarkdown([
            literal,
            "",
            "Real body reference[^real].",
            "",
            "[^real]: Actual footnote detail.",
        ].join("\n"));

        expect(markdown).toContain(literal);
        expect(markdown).toContain("Real body reference\\[1\\].");
        expect(markdown.split("Actual footnote detail.")).toHaveLength(2);
    });

    it("keeps an unresolved reference literal without losing a resolved footnote", () => {
        const { markdown } = prepareShareCardMarkdown([
            "Body cites missing [^missing] and available [^found].",
            "",
            "[^found]: The available definition is retained.",
        ].join("\n"));

        expect(markdown).toContain("missing [^missing]");
        expect(markdown).toContain("available \\[1\\]");
        expect(markdown.split("The available definition is retained.")).toHaveLength(2);
    });

    it.each(["First definition.", "Conflicting second definition."])(
        "fails with a typed error for duplicate labels instead of dropping a definition: %s",
        (secondDefinition) => {
            let failure: unknown;
            try {
                prepareShareCardMarkdown([
                    "Body reference[^duplicate].",
                    "",
                    "[^duplicate]: First definition.",
                    "",
                    `[^duplicate]: ${secondDefinition}`,
                ].join("\n"));
            } catch (error) {
                failure = error;
            }

            expect(failure).toBeInstanceOf(ShareCardPaginationError);
            expect(failure).toMatchObject({ code: "unpageable-content" });
        },
    );

    it("keeps body-reference numbering ahead of references found inside footnotes", () => {
        const { markdown } = prepareShareCardMarkdown([
            "Body cites [^main] and then [^later].",
            "",
            "[^nested]: Nested footnote detail.",
            "",
            "[^main]: Main footnote references [^nested].",
            "",
            "[^later]: Later body footnote detail.",
        ].join("\n"));

        expect(markdown).toContain("Body cites \\[1\\] and then \\[2\\].");
        expect(markdown).toContain("Main footnote references \\[3\\].");
        for (const text of [
            "Main footnote references",
            "Later body footnote detail.",
            "Nested footnote detail.",
        ]) {
            expect(markdown.split(text)).toHaveLength(2);
        }
        expect(markdown.indexOf("Nested footnote detail."))
            .toBeGreaterThan(markdown.indexOf("Later body footnote detail."));
    });

    it("retains a self-reference without expanding the same footnote body again", () => {
        const { markdown } = prepareShareCardMarkdown([
            "Body cites [^self].",
            "",
            "[^self]: Self-reference detail cites [^self].",
        ].join("\n"));

        expect(markdown).toContain("Body cites \\[1\\].");
        expect(markdown).toContain("Self-reference detail cites \\[1\\].");
        expect(markdown.split("Self-reference detail")).toHaveLength(2);
        expect(markdown).not.toContain("[^self]");
    });

    it("applies the existing fence processor allowlist after deindenting footnote Markdown", () => {
        const { markdown } = prepareShareCardMarkdown([
            "Body cites code examples[^code].",
            "",
            "[^code]: Code examples remain Markdown.",
            "",
            "    ```dataviewjs",
            "    dv.pages()",
            "    ```",
            "",
            "    ```mermaid",
            "    graph TD",
            "    A-->B",
            "    ```",
        ].join("\n"));

        expect(markdown).not.toContain("dataviewjs");
        expect(markdown).toContain("```\ndv.pages()\n```");
        expect(markdown).toContain("```mermaid\ngraph TD\nA-->B\n```");
        expect(markdown).toContain("Body cites code examples\\[1\\].");
    });

    it("preserves a footnote-looking literal throughout a multiline inline code span", () => {
        const literal = "`first line [^known]\nsecond line [^known]`";
        const { markdown } = prepareShareCardMarkdown([
            `Use ${literal} and a visible note[^known].`,
            "",
            "[^known]: The actual note detail.",
        ].join("\n"));

        expect(markdown).toContain(literal);
        expect(markdown).toContain("and a visible note\\[1\\].");
        expect(markdown.split("The actual note detail.")).toHaveLength(2);
    });

    it("preserves footnote-looking image alt text and Markdown destinations", () => {
        const literals = [
            "![diagram [^known]](https://example.com/diagram.png)",
            "![reference diagram [^known]][image]",
            "[a link](https://example.com/path/[^known])",
            "![an asset](https://example.com/image/[^known].png)",
            "[image]: https://example.com/reference/[^known].png",
        ];
        const { markdown } = prepareShareCardMarkdown([
            "Body has the actual reference[^known].",
            "",
            ...literals,
            "",
            "[^known]: Actual visible footnote detail.",
        ].join("\n"));

        for (const literal of literals) expect(markdown).toContain(literal);
        expect(markdown).toContain("Body has the actual reference\\[1\\].");
        expect(markdown.split("Actual visible footnote detail.")).toHaveLength(2);
    });

    it.each([
        ["angle destination", "[link](<https://example.com/a)[^known]>)"],
        ["quoted title", "[link](https://example.com \"literal ) [^known]\")"],
        ["continued reference destination", "[ref]:\n  https://example.com/[^known]"],
    ])("preserves footnote-looking text in a %s", (_label, literal) => {
        const { markdown } = prepareShareCardMarkdown([
            "Body has the actual reference[^known].",
            "",
            literal,
            "",
            "[^known]: One actual known definition.",
        ].join("\n"));

        expect(markdown).toContain(literal);
        expect(markdown).toContain("Body has the actual reference\\[1\\].");
        expect(markdown.split("One actual known definition.")).toHaveLength(2);
    });

    it("preserves footnote-looking content after a nested same-tag inline HTML element", () => {
        const literal = "Keep <span><span>literal</span> [^known]</span>.";
        const { markdown } = prepareShareCardMarkdown([
            literal,
            "",
            "Body has the actual reference[^known].",
            "",
            "[^known]: One actual known definition.",
        ].join("\n"));

        expect(markdown).toContain(literal);
        expect(markdown).toContain("Body has the actual reference\\[1\\].");
        expect(markdown.split("One actual known definition.")).toHaveLength(2);
    });

    it("moves a space-plus-tab continuation into the final footnote with its Markdown structure", () => {
        const prepared = prepareShareCardMarkdown([
            "Body has the actual reference[^known].",
            "",
            "[^known]: Main footnote detail.",
            " \t> Continued footnote quote.",
            "",
            "Final body content remains before the notes.",
        ].join("\n"));
        const mainIndex = prepared.markdown.indexOf("Main footnote detail.");
        const continuationIndex = prepared.markdown.indexOf("> Continued footnote quote.");
        const bodyEnd = prepared.markdown.indexOf("Final body content remains before the notes.");
        const quoteLine = prepared.markdown.split("\n").find((line) => (
            line.includes("Continued footnote quote.")
        ));

        expect(mainIndex).toBeGreaterThan(bodyEnd);
        expect(continuationIndex).toBeGreaterThan(mainIndex);
        expect(prepared.markdown.split("Continued footnote quote.")).toHaveLength(2);
        expect(quoteLine).toMatch(/^> Continued footnote quote\.$/u);
        expect(prepared.markdown).toContain("Body has the actual reference\\[1\\].");
    });

    it("does not end image alt parsing at a closing bracket inside inline code", () => {
        const literal = "![a `]` [^known]](data:image/png;base64,AAAA)";
        const { markdown } = prepareShareCardMarkdown([
            literal,
            "",
            "Body has the actual reference[^known].",
            "",
            "[^known]: One actual known definition.",
        ].join("\n"));

        expect(markdown).toContain(literal);
        expect(markdown).toContain("Body has the actual reference\\[1\\].");
        expect(markdown.split("One actual known definition.")).toHaveLength(2);
    });

    it("leaves content without footnotes unchanged, including ordinary link and image references", () => {
        const input = [
            "Plain body with **emphasis**, [a link][link] and ![a chart][image].",
            "",
            "[link]: https://example.com/article",
            "[image]: data:image/png;base64,AAAA",
            "",
            "`literal syntax` and \\[escaped] remain.",
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
