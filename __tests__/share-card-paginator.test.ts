import {
    paginateShareCardMarkdown,
    ShareCardPaginationError,
    ShareCardTooLargeError,
} from "../src/share-card/share-card-paginator";
import {
    MAX_SHARE_CARD_CHARACTERS,
    MAX_SHARE_CARD_PAGES,
} from "../src/share-card/share-card-types";
import { prepareShareCardMarkdown } from "../src/share-card/share-card-markdown";

function removeRepeatedWrapper(
    markdown: string,
    opening: string,
    closing: string,
): string {
    const withoutOpening = markdown.startsWith(opening)
        ? markdown.slice(opening.length)
        : markdown;
    const trailing = /\s*$/u.exec(withoutOpening)?.[0] ?? "";
    const core = withoutOpening.slice(0, withoutOpening.length - trailing.length);
    expect(core.endsWith(closing)).toBe(true);
    return core.slice(0, -closing.length) + trailing;
}

describe("paginateShareCardMarkdown", () => {
    it("greedily appends semantic blocks using the measured page index", async () => {
        const measurements: Array<{ markdown: string; pageIndex: number }> = [];
        const pages = await paginateShareCardMarkdown(
            ["alpha", "beta", "gamma"],
            async (markdown, pageIndex) => {
                measurements.push({ markdown, pageIndex });
                return markdown.length <= 11;
            },
        );

        expect(pages).toEqual([
            { pageIndex: 0, totalPages: 2, content: "alpha\n\nbeta" },
            { pageIndex: 1, totalPages: 2, content: "gamma" },
        ]);
        expect(measurements).toContainEqual({ markdown: "alpha\n\nbeta", pageIndex: 0 });
        expect(measurements).toContainEqual({ markdown: "gamma", pageIndex: 1 });
    });

    it("bounds measured renders for thousands of short semantic blocks", async () => {
        const blocks = Array.from({ length: 16_000 }, () => "x");
        const fits = jest.fn((markdown: string) => markdown.length <= 2_398);

        const pages = await paginateShareCardMarkdown(blocks, fits);

        expect(pages).toHaveLength(20);
        expect(pages.map((page) => page.content).join("\n\n"))
            .toBe(blocks.join("\n\n"));
        expect(pages.every((page) => page.content.length <= 2_398)).toBe(true);
        expect(fits.mock.calls.length).toBeLessThanOrEqual(350);
    });

    it("returns the explicit one-page fallback for empty content", async () => {
        const fits = jest.fn(() => true);

        await expect(paginateShareCardMarkdown(["", " \n "], fits)).resolves.toEqual([
            { pageIndex: 0, totalPages: 1, content: "" },
        ]);
        expect(fits).not.toHaveBeenCalled();
    });

    it("splits a long plain line at words without losing or reordering text", async () => {
        const original = "one two three four five";
        const pages = await paginateShareCardMarkdown(
            [original],
            (markdown) => markdown.length <= 8,
        );

        expect(pages.length).toBeGreaterThan(1);
        expect(pages.every((page) => page.content.length > 0)).toBe(true);
        expect(pages.map((page) => page.content).join("")).toBe(original);
    });

    it("uses Unicode code-point-safe progress for an unbroken CJK/emoji line", async () => {
        const original = "甲乙😀丙丁戊己";
        const pages = await paginateShareCardMarkdown(
            [original],
            (markdown) => Array.from(markdown).length <= 2,
        );

        expect(pages.map((page) => page.content).join("")).toBe(original);
        expect(pages.every((page) => !page.content.includes("�"))).toBe(true);
    });

    it("repeats fenced-code wrappers when a code block must split", async () => {
        const block = [
            "```ts",
            "const first = 1;",
            "const second = 2;",
            "const third = 3;",
            "```",
        ].join("\n");
        const pages = await paginateShareCardMarkdown(
            [block],
            (markdown) => markdown.length <= 32,
        );

        expect(pages.length).toBeGreaterThan(1);
        for (const page of pages) {
            expect(page.content.startsWith("```ts\n")).toBe(true);
            expect(page.content.endsWith("```")).toBe(true);
        }
        const visibleCode = pages.map((page) => (
            page.content.slice("```ts\n".length, -"```".length)
        )).join("");
        expect(visibleCode).toBe("const first = 1;\nconst second = 2;\nconst third = 3;\n");
    });

    it.each([
        ["emphasis", "*", "*"],
        ["strong", "**", "**"],
        ["inline code", "`", "`"],
    ])("repeats valid %s wrappers without losing source text", async (
        _label,
        opening,
        closing,
    ) => {
        const text = Array.from({ length: 18 }, (_, index) => `词${index}😀`).join(" ");
        const pages = await paginateShareCardMarkdown(
            [`${opening}${text}${closing}`],
            (markdown) => markdown.length <= 34,
        );

        expect(pages.length).toBeGreaterThan(1);
        expect(pages.map((page) => removeRepeatedWrapper(
            page.content,
            opening,
            closing,
        )).join("")).toBe(text);
    });

    it("repeats a complete link around every forced label fragment", async () => {
        const destination = "https://example.com/reference";
        const label = Array.from({ length: 16 }, (_, index) => `label-${index}`).join(" ");
        const pages = await paginateShareCardMarkdown(
            [`[${label}](${destination})`],
            (markdown) => markdown.length <= 58,
        );

        expect(pages.length).toBeGreaterThan(1);
        const fragments = pages.map((page) => {
            const trailing = /\s*$/u.exec(page.content)?.[0] ?? "";
            const core = page.content.slice(0, page.content.length - trailing.length);
            const match = /^\[([\s\S]*)\]\(https:\/\/example\.com\/reference\)$/u.exec(core);
            expect(match).not.toBeNull();
            return (match?.[1] ?? "") + trailing;
        });
        expect(fragments.join("")).toBe(label);
    });

    it("fails closed rather than separating a reference link from its definition", async () => {
        const original = "[label][ref]\n[ref]: https://e.x";

        await expect(paginateShareCardMarkdown(
            [original],
            (markdown) => markdown.length <= 20,
        )).rejects.toMatchObject({ code: "unpageable-content" });
        await expect(paginateShareCardMarkdown(
            ["[label][ref]", "[ref]: https://e.x"],
            (markdown) => markdown.length <= 20,
        )).rejects.toMatchObject({ code: "unpageable-content" });

        await expect(paginateShareCardMarkdown(
            [original],
            () => true,
        )).resolves.toEqual([
            { pageIndex: 0, totalPages: 1, content: original },
        ]);
    });

    it.each([
        ["blockquote", "> "],
        ["list", "- "],
    ])("detects a separated reference definition inside a %s", async (
        _label,
        prefix,
    ) => {
        await expect(paginateShareCardMarkdown(
            [`${prefix}[label][ref]`, `${prefix}[ref]: https://e.x`],
            (markdown) => markdown.length <= 24,
        )).rejects.toMatchObject({ code: "unpageable-content" });
    });

    it("ignores reference-looking literals inside fenced code", async () => {
        const blocks = [
            ["```", "[ref]", "```"].join("\n"),
            "[ref]: https://e.x",
        ];
        const pages = await paginateShareCardMarkdown(
            blocks,
            (markdown) => markdown.length <= 20,
        );

        expect(pages.map((page) => page.content).join("\n\n"))
            .toBe(blocks.join("\n\n"));
    });

    it.each([
        ["heading", "# [ref]: https://e.x"],
        ["task", "- [ ] [ref]: https://e.x"],
    ])("does not treat a %s prefix as a reference-definition container", async (
        _label,
        falseDefinition,
    ) => {
        const blocks = ["[label][ref]", falseDefinition];
        const pages = await paginateShareCardMarkdown(
            blocks,
            (markdown) => markdown.length <= 24,
        );

        expect(pages.map((page) => page.content).join("\n\n"))
            .toBe(blocks.join("\n\n"));
    });

    it("finds a reference use after an unmatched literal backtick run", async () => {
        await expect(paginateShareCardMarkdown(
            ["` unmatched [label][ref]", "[ref]: https://e.x"],
            (markdown) => markdown.length <= 28,
        )).rejects.toMatchObject({ code: "unpageable-content" });
    });

    it.each([
        ["heading", "## "],
        ["list", "- "],
        ["quote", "> "],
    ])("repeats the %s container for code-point-safe fragments", async (
        _label,
        prefix,
    ) => {
        const text = "甲乙😀丙丁\\*戊己庚辛壬癸";
        const pages = await paginateShareCardMarkdown(
            [`${prefix}${text}`],
            (markdown) => Array.from(markdown).length <= 8,
        );

        expect(pages.length).toBeGreaterThan(1);
        expect(pages.every((page) => page.content.startsWith(prefix))).toBe(true);
        expect(pages.every((page) => !page.content.includes("�"))).toBe(true);
        expect(pages.map((page) => page.content.slice(prefix.length)).join("")).toBe(text);
        expect(pages.every((page) => !/\\$/u.test(page.content))).toBe(true);
    });

    it("keeps nested quote/list/strong/link wrappers valid on every page", async () => {
        const destination = "https://example.com/nested";
        const label = Array.from({ length: 20 }, (_, index) => `nested-${index}`).join(" ");
        const pages = await paginateShareCardMarkdown(
            [`> - **[${label}](${destination})**`],
            (markdown) => markdown.length <= 62,
        );

        expect(pages.length).toBeGreaterThan(1);
        const fragments = pages.map((page) => {
            const trailing = /\s*$/u.exec(page.content)?.[0] ?? "";
            const core = page.content.slice(0, page.content.length - trailing.length);
            const match = /^> - \*\*\[([\s\S]*)\]\(https:\/\/example\.com\/nested\)\*\*$/u.exec(core);
            expect(match).not.toBeNull();
            return (match?.[1] ?? "") + trailing;
        });
        expect(fragments.join("")).toBe(label);
    });

    it.each([
        [
            "blockquote",
            ["> ```", "> first line", "> second line", "> third line", "> ```"].join("\n"),
            "> ```",
            "> ```",
        ],
        [
            "list",
            ["- ~~~", "  first line", "  second line", "  third line", "  ~~~"].join("\n"),
            "- ~~~",
            "  ~~~",
        ],
    ])("rebuilds a valid %s fenced-code container at line boundaries", async (
        _label,
        block,
        opening,
        closing,
    ) => {
        const pages = await paginateShareCardMarkdown(
            [block],
            (markdown) => markdown.length <= 32,
        );

        expect(pages).toHaveLength(3);
        expect(pages.every((page) => page.content.startsWith(`${opening}\n`))).toBe(true);
        expect(pages.every((page) => page.content.endsWith(closing))).toBe(true);
        const body = pages.map((page) => {
            const withoutOpening = page.content.slice(opening.length + 1);
            return withoutOpening.slice(0, -closing.length);
        }).join("");
        expect(body).toBe(block.slice(opening.length + 1, -(closing.length)));
    });

    it.each([
        [
            "tab-padded blockquote",
            [">\t```processor", ">\tfirst", ">\tsecond", ">\tthird", ">\t```"].join("\n"),
            ">   ```",
            ">   ```",
        ],
        [
            "tab-padded list",
            ["-\t~~~processor", "    first", "    second", "    third", "    ~~~"].join("\n"),
            "-   ~~~",
            "    ~~~",
        ],
    ])("uses CommonMark tab stops for a %s fence", async (
        _label,
        source,
        opening,
        closing,
    ) => {
        const prepared = prepareShareCardMarkdown(source);
        const pages = await paginateShareCardMarkdown(
            prepared.blocks,
            (markdown) => markdown.length <= 31,
        );

        expect(pages.length).toBeGreaterThan(1);
        expect(pages.every((page) => page.content.startsWith(`${opening}\n`))).toBe(true);
        expect(pages.every((page) => page.content.endsWith(closing))).toBe(true);
    });

    it("rebuilds an inherited list-continuation fence after preparation", async () => {
        const prepared = prepareShareCardMarkdown([
            "- Item",
            "    ```processor",
            "    first line",
            "    second line",
            "    third line",
            "    ```",
        ].join("\n"));
        expect(prepared.blocks).toHaveLength(2);

        const pages = await paginateShareCardMarkdown(
            prepared.blocks,
            (markdown) => markdown.length <= 32,
        );
        const fencePages = pages.slice(1);

        expect(pages[0]?.content).toBe("- Item");
        expect(fencePages.length).toBeGreaterThan(1);
        expect(fencePages.every((page) => page.content.startsWith("-   ```\n"))).toBe(true);
        expect(fencePages.every((page) => page.content.endsWith("    ```"))).toBe(true);
    });

    it.each([
        [
            "ordered-list",
            ["1. ```ts", "   first", "   second", "   third", "   ```"].join("\n"),
            "1. ```ts",
            "   ```",
        ],
        [
            "blockquote",
            ["> ```ts", "> first", "> second", "> third", "> ```"].join("\n"),
            "> ```ts",
            "> ```",
        ],
    ])("preserves a direct %s marker and fence info on every fragment", async (
        _label,
        block,
        opening,
        closing,
    ) => {
        const pages = await paginateShareCardMarkdown(
            [block],
            (markdown) => markdown.length <= 25,
        );

        expect(pages.length).toBeGreaterThan(1);
        expect(pages.every((page) => page.content.startsWith(`${opening}\n`))).toBe(true);
        expect(pages.every((page) => page.content.endsWith(closing))).toBe(true);
    });

    it("does not reinterpret top-level tab-indented code as a fence", async () => {
        await expect(paginateShareCardMarkdown(
            [["\t```", "\tcode", "\t```"].join("\n")],
            (markdown) => markdown.length <= 8,
        )).rejects.toMatchObject({
            name: "ShareCardPaginationError",
            code: "unpageable-content",
        });
    });

    it("handles escaped emphasis markers and fails closed on ambiguous delimiter runs", async () => {
        const safe = `*${"word ".repeat(12)}\\*literal\\* tail*`;
        const pages = await paginateShareCardMarkdown(
            [safe],
            (markdown) => markdown.length <= 28,
        );
        expect(pages.length).toBeGreaterThan(1);
        expect(pages.map((page) => removeRepeatedWrapper(page.content, "*", "*")).join(""))
            .toBe(safe.slice(1, -1));

        for (const ambiguous of [
            `***${"ambiguous ".repeat(10)}***`,
            `${"prefix ".repeat(6)}a*b*c`,
            `**${"mismatched ".repeat(8)}*`,
        ]) {
            await expect(paginateShareCardMarkdown(
                [ambiguous],
                (markdown) => markdown.length <= 30,
            )).rejects.toMatchObject({ code: "unpageable-content" });
        }
    });

    it("fails closed before splitting an internal inline-code backtick run", async () => {
        await expect(paginateShareCardMarkdown(
            ["`aa``bb cc dd`"],
            (markdown) => markdown.length <= 4,
        )).rejects.toMatchObject({ code: "unpageable-content" });
    });

    it("does not promote a mid-line marker into an empty block on a new page", async () => {
        const original = "abc* def";
        const pages = await paginateShareCardMarkdown(
            [original],
            (markdown) => markdown.length <= 3,
        );

        expect(pages.map((page) => page.content).join("")).toBe(original);
        expect(pages.every((page) => !/^ {0,3}\*[ \t]/u.test(page.content))).toBe(true);
    });

    it("fails closed instead of returning an empty fenced-code page", async () => {
        await expect(paginateShareCardMarkdown(
            [["```", "", "abc", "```"].join("\n")],
            (markdown) => markdown.length <= 9,
        )).rejects.toMatchObject({ code: "unpageable-content" });
    });

    it("fails closed instead of silently dropping trailing whitespace", async () => {
        await expect(paginateShareCardMarkdown(
            ["abc  "],
            (markdown) => markdown.length <= 3,
        )).rejects.toMatchObject({ code: "unpageable-content" });
    });

    it("fails closed for complex oversized Markdown it cannot safely fragment", async () => {
        const table = [
            "| Column A | Column B |",
            "| --- | --- |",
            `| ${"long ".repeat(20)} | value |`,
        ].join("\n");

        await expect(paginateShareCardMarkdown(
            [table],
            (markdown) => markdown.length <= 30,
        )).rejects.toMatchObject({
            name: "ShareCardPaginationError",
            code: "unpageable-content",
        });
    });

    it("paginates a prepared mixed document with more than sixty source lines", async () => {
        const source = Array.from({ length: 64 }, (_, index) => (
            index % 3 === 0 ? `## Heading ${index}` : `Paragraph ${index} with **evidence**.`
        )).join("\n\n");
        const prepared = prepareShareCardMarkdown(source);
        const pages = await paginateShareCardMarkdown(
            prepared.blocks,
            (markdown) => markdown.length <= 180,
        );

        expect(pages.length).toBeGreaterThan(1);
        expect(pages.map((page) => page.content).join("\n\n"))
            .toBe(prepared.blocks.join("\n\n"));
    });

    it("accepts exactly 50k characters and rejects 50k plus one", async () => {
        await expect(paginateShareCardMarkdown(
            ["x".repeat(MAX_SHARE_CARD_CHARACTERS)],
            () => true,
        )).resolves.toHaveLength(1);

        await expect(paginateShareCardMarkdown(
            ["x".repeat(MAX_SHARE_CARD_CHARACTERS + 1)],
            () => true,
        )).rejects.toMatchObject({ code: "content-too-large" });
    });

    it("accepts exactly 24 measured pages before rejecting a twenty-fifth", async () => {
        const pages = await paginateShareCardMarkdown(
            Array.from({ length: MAX_SHARE_CARD_PAGES }, () => "x"),
            (markdown) => markdown === "x",
        );
        expect(pages).toHaveLength(MAX_SHARE_CARD_PAGES);

        await expect(paginateShareCardMarkdown(
            Array.from({ length: MAX_SHARE_CARD_PAGES + 1 }, () => "x"),
            (markdown) => markdown === "x",
        )).rejects.toMatchObject({ code: "page-limit-exceeded" });
    });

    it("rejects input above the character limit without returning partial pages", async () => {
        const promise = paginateShareCardMarkdown(
            ["x".repeat(MAX_SHARE_CARD_CHARACTERS + 1)],
            () => true,
        );

        await expect(promise).rejects.toMatchObject({
            name: "ShareCardTooLargeError",
            code: "content-too-large",
            reason: "character-limit",
        });
    });

    it("rejects a twenty-fifth measured page with a typed too-large error", async () => {
        const blocks = Array.from({ length: MAX_SHARE_CARD_PAGES + 1 }, () => "x");
        const promise = paginateShareCardMarkdown(blocks, (markdown) => markdown === "x");

        await expect(promise).rejects.toBeInstanceOf(ShareCardTooLargeError);
        await expect(promise).rejects.toMatchObject({
            code: "page-limit-exceeded",
            reason: "page-limit",
            limit: MAX_SHARE_CARD_PAGES,
        });
    });

    it("wraps measurement failure and impossible progress as typed errors", async () => {
        await expect(paginateShareCardMarkdown(["text"], () => {
            throw new Error("renderer failed");
        })).rejects.toMatchObject({
            name: "ShareCardPaginationError",
            code: "measurement-failed",
        });

        await expect(paginateShareCardMarkdown(["x"], () => false))
            .rejects.toBeInstanceOf(ShareCardPaginationError);
    });
});
