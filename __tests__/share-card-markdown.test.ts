import {
    prepareShareCardMarkdown,
    serializePageletFindings,
} from "../src/share-card/share-card-markdown";

describe("Share Card Markdown preparation", () => {
    it("normalizes CRLF without stripping leading thematic/frontmatter-like text", () => {
        const input = "---\r\ntitle: Kept\r\n---\r\n\r\n# Heading\r\n";

        const prepared = prepareShareCardMarkdown(input);

        expect(prepared.markdown).toBe("---\ntitle: Kept\n---\n\n# Heading\n");
        expect(prepared.blocks).toEqual([
            "---\ntitle: Kept\n---",
            "# Heading",
        ]);
    });

    it("makes Markdown, wiki and HTML media readable without retaining loadable syntax", () => {
        const prepared = prepareShareCardMarkdown([
            "Before ![sunset](https://example.com/sunset.png) after.",
            "![parenthesized](https://example.com/charts/a_(final).png)",
            "![[assets/chart.png|Quarterly chart]]",
            "<picture><source srcset=\"https://example.com/2x.png\"><img src=\"x.png\" alt=\"Cover\"></picture>",
            "<img src=\"https://example.com/private.png\" alt=\"Private chart\">",
            "<iframe src=\"https://example.com/embed\" title=\"Demo\"></iframe>",
            "[ordinary link](https://example.com/page)",
        ].join("\n"));

        expect(prepared.markdown).toContain("[Image: sunset]");
        expect(prepared.markdown).toContain("[Image: parenthesized]");
        expect(prepared.markdown).toContain("[Embed: Quarterly chart]");
        expect(prepared.markdown).toContain("[Picture: Cover]");
        expect(prepared.markdown).toContain("[Image: Private chart]");
        expect(prepared.markdown).toContain("[Iframe: Demo]");
        expect(prepared.markdown).toContain("[ordinary link](https://example.com/page)");
        expect(prepared.markdown).not.toContain("sunset.png");
        expect(prepared.markdown).not.toContain("a_(final).png");
        expect(prepared.markdown).not.toMatch(/!\[|!\[\[|<picture|<source|<img|<iframe/i);
    });

    it("removes raw HTML resource and event attributes before rendering", () => {
        const prepared = prepareShareCardMarkdown([
            "<div class=\"remote-bg\" id=\"private-id\" data-note=\"private\" style=\"background: url('https://example.com/bg.png')\" background=\"https://example.com/legacy.png\" onclick=\"fetch('https://example.com/click')\">",
            "<a href=\"https://example.com/private\" ping=\"https://example.com/ping\">Readable link</a>",
            "<form action=\"https://example.com/submit\"><button formaction=\"https://example.com/button\">Send</button></form>",
            "<remote-widget data-source=\"https://example.com/widget\">Custom text</remote-widget>",
            "</div>",
        ].join("\n"));

        expect(prepared.markdown).toContain("Readable link");
        expect(prepared.markdown).toContain("Send");
        expect(prepared.markdown).toContain("Custom text");
        expect(prepared.markdown).not.toContain("remote-widget");
        expect(prepared.markdown).not.toContain("https://example.com");
        expect(prepared.markdown).not.toMatch(/\s(?:action|background|class|data-[\w-]+|formaction|href|id|onclick|ping|style)\s*=/i);
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

    it("preserves literal media syntax in code while disabling executable fence processors", () => {
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

    it("strips processor info from top-level backtick and tilde fences", () => {
        const prepared = prepareShareCardMarkdown([
            "```dataviewjs",
            "dv.list(['backtick']);",
            "```",
            "",
            "~~~mermaid",
            "graph TD",
            "~~~",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "```",
            "dv.list(['backtick']);",
            "```",
            "",
            "~~~",
            "graph TD",
            "~~~",
        ].join("\n"));
    });

    it("strips processor info from blockquote fences and resumes after its matching close", () => {
        const prepared = prepareShareCardMarkdown([
            "> ```dataviewjs",
            "> dv.list(['![literal](https://example.com/code.png)']);",
            "> ```",
            "Outside ![chart](https://example.com/chart.png).",
            "~~~mermaid",
            "graph TD",
            "~~~",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "> ```",
            "> dv.list(['![literal](https://example.com/code.png)']);",
            "> ```",
            "Outside [Image: chart].",
            "~~~",
            "graph TD",
            "~~~",
        ].join("\n"));
    });

    it("strips processor info from list-item fences using its continuation prefix", () => {
        const prepared = prepareShareCardMarkdown([
            "- ```dataviewjs",
            "  dv.pages()",
            "  ",
            "  ```",
            "After ![chart](https://example.com/chart.png).",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "- ```",
            "  dv.pages()",
            "  ",
            "  ```",
            "After [Image: chart].",
        ].join("\n"));
        expect(prepared.blocks[0]).toBe([
            "- ```",
            "  dv.pages()",
            "  ",
            "  ```",
        ].join("\n"));
    });

    it("strips processor info from nested quote-list fences", () => {
        const prepared = prepareShareCardMarkdown([
            "> - ~~~dataviewjs",
            ">   dv.pages()",
            ">   ~~~",
            "> After ![chart](https://example.com/chart.png).",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "> - ~~~",
            ">   dv.pages()",
            ">   ~~~",
            "> After [Image: chart].",
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

        expect(prepared.markdown).toBe([
            "> 10. Item",
            "lazy continuation",
            ">     ```",
            ">     dv.pages()",
            ">     ```",
        ].join("\n"));
    });

    it("does not let a non-one ordered marker interrupt an open paragraph", () => {
        const prepared = prepareShareCardMarkdown([
            "Paragraph stays open",
            "2. ~~~dataviewjs",
            "   <img src=\"https://example.com/private.png\" alt=\"Private\">",
            "   ~~~",
        ].join("\n"));

        expect(prepared.markdown).toContain("2. ~~~dataviewjs");
        expect(prepared.markdown).toContain("   [Image: Private]");
        expect(prepared.markdown).not.toContain("private.png");
    });

    it.each(["*", "1."])(
        "does not let an empty %s list item interrupt an open paragraph",
        (marker) => {
            const prepared = prepareShareCardMarkdown([
                "Paragraph stays open",
                marker,
                "    ~~~dataviewjs",
                "    ![secret](https://example.com/private.png)",
            ].join("\n"));

            expect(prepared.markdown).toContain("    ~~~dataviewjs");
            expect(prepared.markdown).toContain("    [Image: secret]");
            expect(prepared.markdown).not.toContain("private.png");
        },
    );

    it.each([
        "<https://example.com>",
        "<span>inline HTML</span>",
    ])("keeps list context across lazy inline markup %s", (lazyLine) => {
        const prepared = prepareShareCardMarkdown([
            "> 10. Item",
            lazyLine,
            ">     ```dataviewjs",
            ">     dv.pages()",
            ">     ```",
        ].join("\n"));

        expect(prepared.markdown).toContain(lazyLine);
        expect(prepared.markdown).toContain(">     ```\n>     dv.pages()");
        expect(prepared.markdown).not.toContain("dataviewjs");
    });

    it.each([
        ["a Setext heading", ["Heading", "==="]],
        ["top-level indented code", ["    literal code"]],
    ])("allows a non-one ordered fence after %s", (_label, prefix) => {
        const prepared = prepareShareCardMarkdown([
            ...prefix,
            "2. ```dataviewjs",
            "   dv.pages()",
            "   ```",
        ].join("\n"));

        expect(prepared.markdown).toContain("2. ```\n   dv.pages()");
        expect(prepared.markdown).not.toContain("dataviewjs");
    });

    it("does not treat mixed thematic-break markers as closing an open paragraph", () => {
        const prepared = prepareShareCardMarkdown([
            "Paragraph stays open",
            "*-*",
            "2. ~~~dataviewjs",
            "   ![secret](https://example.com/private.png)",
        ].join("\n"));

        expect(prepared.markdown).toContain("2. ~~~dataviewjs");
        expect(prepared.markdown).toContain("   [Image: secret]");
        expect(prepared.markdown).not.toContain("private.png");
    });

    it.each([
        ["script", ["<script>", "const literal = true;", "</script>"]],
        ["comment", ["<!--", "literal comment", "-->"]],
    ])("allows a non-one ordered fence after an explicitly closed %s HTML block", (_label, html) => {
        const prepared = prepareShareCardMarkdown([
            ...html,
            "2. ```dataviewjs",
            "   dv.pages()",
            "   ```",
        ].join("\n"));

        expect(prepared.markdown).toContain("2. ```\n   dv.pages()");
        expect(prepared.markdown).not.toContain("dataviewjs");
    });

    it("preserves media-looking literals throughout top-level indented code", () => {
        const input = [
            "    <picture><img src=\"https://example.com/private.png\" alt=\"literal\"></picture>",
            "\t![literal](https://example.com/literal.png)",
        ].join("\n");

        const prepared = prepareShareCardMarkdown(input);

        expect(prepared.markdown).toBe(input);
        expect(prepared.blocks).toEqual([input]);
    });

    it.each([
        [
            "blockquote",
            [
                ">     <picture>ordinary indented text</picture>",
                ">     ![literal](https://example.com/literal.png)",
            ],
        ],
        [
            "list continuation",
            [
                "- Item",
                "",
                "      <picture>ordinary indented text</picture>",
                "      ![literal](https://example.com/literal.png)",
            ],
        ],
    ])("preserves media-looking literals in %s indented code", (_label, lines) => {
        const input = lines.join("\n");

        expect(prepareShareCardMarkdown(input).markdown).toBe(input);
    });

    it("sanitizes a list continuation below the four-column code threshold", () => {
        const prepared = prepareShareCardMarkdown([
            "- Item",
            "",
            "    <picture><img src=\"https://example.com/private.png\"></picture>",
        ].join("\n"));

        expect(prepared.markdown).toContain("    [Picture]");
        expect(prepared.markdown).not.toContain("private.png");
    });

    it("preserves fence-looking text inside top-level indented code", () => {
        const input = [
            "    ```dataviewjs",
            "    literal text",
            "    ```",
        ].join("\n");

        expect(prepareShareCardMarkdown(input).markdown).toBe(input);
    });

    it("stops preserving code when an unclosed list fence loses its container", () => {
        const prepared = prepareShareCardMarkdown([
            "- Item",
            "  ~~~dataviewjs",
            "  ![literal](https://example.com/code.png)",
            "Outside <img src=\"https://example.com/private.png\" alt=\"Private\">",
        ].join("\n"));

        expect(prepared.markdown).toContain("  ~~~\n  ![literal](https://example.com/code.png)");
        expect(prepared.markdown).toContain("Outside [Image: Private]");
        expect(prepared.markdown).not.toContain("private.png");
    });

    it("uses tab-stop indentation when a list fence loses its container", () => {
        const prepared = prepareShareCardMarkdown([
            "-\t~~~dataviewjs",
            "  <img src=\"https://example.com/private.png\" alt=\"Private\">",
            "  ~~~",
        ].join("\n"));

        expect(prepared.markdown).toContain("-\t~~~");
        expect(prepared.markdown).toContain("  [Image: Private]");
        expect(prepared.markdown).not.toContain("private.png");
    });

    it("does not reinterpret an invalid backtick info string as a fence", () => {
        const input = [
            "```bad`info",
            "    <img src=\"https://example.com/private.png\" alt=\"Private\">",
        ].join("\n");
        const prepared = prepareShareCardMarkdown(input);

        expect(prepared.markdown).toBe([
            "```bad`info",
            "    [Image: Private]",
        ].join("\n"));
    });

    it("does not rewrite media-looking literals inside inline code", () => {
        const prepared = prepareShareCardMarkdown([
            "Use `![literal](https://example.com/code.png)` as the example.",
            "Outside ![chart](https://example.com/chart.png).",
        ].join("\n"));

        expect(prepared.markdown).toContain("`![literal](https://example.com/code.png)`");
        expect(prepared.markdown).toContain("Outside [Image: chart].");
    });

    it("preserves raw HTML attributes when they are literal inline code", () => {
        const literal = "`<div style=\"background:url(https://example.com/code.png)\">`";

        expect(prepareShareCardMarkdown(literal).markdown).toBe(literal);
    });

    it("neutralizes nested-alt and shortcut-reference images before rendering", () => {
        const prepared = prepareShareCardMarkdown([
            "![outer [inner]](https://example.com/nested.png)",
            "![shortcut]",
            "",
            "[shortcut]: https://example.com/reference.png",
        ].join("\n"));

        expect(prepared.markdown).toContain("[Image: outer [inner]]");
        expect(prepared.markdown).toContain("[Image: shortcut]");
        expect(prepared.markdown).not.toMatch(/!\[/);
        expect(prepared.markdown).not.toContain("nested.png");
    });

    it("does not consume a later reference definition as part of a shortcut image", () => {
        const prepared = prepareShareCardMarkdown([
            "![shortcut]",
            "",
            "[shortcut]: https://example.com/private.png",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "[Image: shortcut]",
            "",
            "[shortcut]: https://example.com/private.png",
        ].join("\n"));
    });

    it("preserves an ordinary link following a shortcut image", () => {
        const prepared = prepareShareCardMarkdown([
            "![shortcut]",
            "[ordinary link](https://example.com/page)",
        ].join("\n"));

        expect(prepared.markdown).toBe([
            "[Image: shortcut]",
            "[ordinary link](https://example.com/page)",
        ].join("\n"));
    });

    it("continues neutralizing valid reference images after a malformed opener", () => {
        const prepared = prepareShareCardMarkdown([
            "![broken",
            "![valid][private-image]",
            "",
            "[private-image]: https://example.com/private.png",
        ].join("\n"));

        expect(prepared.markdown).toContain("![broken");
        expect(prepared.markdown).toContain("[Image: valid]");
        expect(prepared.markdown).not.toContain("![valid][private-image]");
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
