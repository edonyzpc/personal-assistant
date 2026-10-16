import {
    applyShareCardReferenceDefinitionContext,
    createShareCardFragmentBoundaryPlan,
    createShareCardReferenceDefinitionContext,
    isAtomicShareCardVisualBlock,
    isPureShareCardVisualBlock,
    paginateShareCardMarkdown,
    MAX_SHARE_CARD_FRAGMENT_BOUNDARIES,
    ShareCardPaginationCancelledError,
    ShareCardPaginationError,
    type ShareCardPaginationOptions,
} from "../src/share-card/share-card-paginator";
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
    it.each([
        "![remote](data:image/png;base64,AAAA)",
        "![[asset.png]]",
        "<img src=\"data:image/png;base64,AAAA\">",
        "<svg viewBox=\"0 0 10 10\"><path d=\"M0 0\"/></svg>",
        "```mermaid\ngraph TD\nA-->B\n```",
    ])("keeps an approved visual block atomic: %s", async (block) => {
        expect(isAtomicShareCardVisualBlock(block)).toBe(true);
        expect(isPureShareCardVisualBlock(block)).toBe(true);
        expect(createShareCardFragmentBoundaryPlan(block)).toBeNull();
        await expect(paginateShareCardMarkdown([block], () => false))
            .rejects.toMatchObject({ code: "unpageable-content" });
    });

    it("never treats mixed visible text and an inline image as a pure constrained visual", async () => {
        const block = `${"before ".repeat(30)}![chart](data:image/png;base64,AAAA) ${"after ".repeat(30)}`;

        expect(isAtomicShareCardVisualBlock(block)).toBe(true);
        expect(isPureShareCardVisualBlock(block)).toBe(false);
        await expect(paginateShareCardMarkdown([block], () => false))
            .rejects.toMatchObject({ code: "unpageable-content" });
    });

    it("accepts localized resource data URLs larger than the retired text limit", async () => {
        const localized = `![image](data:image/png;base64,${"A".repeat(50_001)})`;

        await expect(paginateShareCardMarkdown(
            [localized],
            () => true,
        )).resolves.toEqual([
            { pageIndex: 0, totalPages: 1, content: localized },
        ]);
    });

    it("greedily packs a small visual with adjacent text", async () => {
        const visual = "```mermaid\ngraph TD\nA-->B\n```";
        const fits = jest.fn((_content: string) => true);

        const pages = await paginateShareCardMarkdown(
            ["before", visual, "after"],
            fits,
        );

        expect(pages.map((page) => page.content)).toEqual([
            `before\n\n${visual}\n\nafter`,
        ]);
        expect(fits).toHaveBeenCalledTimes(1);
    });

    it("moves a whole visual with adjacent text to the next page when that prefix fits", async () => {
        const visual = "![chart](data:image/png;base64,AAAA)";
        const pages = await paginateShareCardMarkdown(
            ["before", visual, "after"],
            (content) => content !== `before\n\n${visual}\n\nafter`
                && content !== "before\n\n" + visual + "\n\nafter",
        );

        expect(pages).toHaveLength(2);
        expect(pages[0]?.content).toContain(visual);
        expect(pages[0]?.content).toContain("before");
        expect(pages[1]?.content).toBe("after");
    });

    it.each([
        "`![literal](image.png)`",
        "```md\n![literal](image.png)\n```",
        "    ![literal](image.png)",
        "-     ![literal](image.png)",
        ">     ![literal](image.png)",
        "<pre>![literal](image.png)</pre>",
        "<pre>\n![literal](image.png)\n</pre>",
        "<code>![literal](image.png)</code>",
    ])("does not classify code-literal visual syntax as atomic: %s", (block) => {
        expect(isAtomicShareCardVisualBlock(block)).toBe(false);
    });

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

    it("paginates plain text around complete atomic sup/span HTML annotations", async () => {
        const annotations = [11, 16].map((page) => (
            `<sup><span title="Page / location: ${page}">:\u200a${page}</span> </sup>`
        ));
        const source = `${"Before ".repeat(30)}${annotations[0]}${" After ".repeat(30)}${annotations[1]}${" End ".repeat(30)}`;
        const visibleText = (markdown: string): string => annotations.reduce(
            (text, annotation, index) => text.split(annotation).join(`:\u200a${[11, 16][index]} `),
            markdown,
        );
        const plan = createShareCardFragmentBoundaryPlan(source);
        expect(plan).not.toBeNull();
        expect(plan?.renderText?.(0, source.length)).toBe(visibleText(source));
        for (const annotation of annotations) {
            const start = source.indexOf(annotation);
            const end = start + annotation.length;
            expect(plan?.boundaries.some((boundary) => boundary > start && boundary < end)).toBe(false);
            expect(plan?.insertions.some((insertion) => (
                insertion.insertionOffset > start && insertion.insertionOffset < end
            ))).toBe(false);
        }

        const pages = await paginateShareCardMarkdown([source], (markdown) => visibleText(markdown).length <= 100);
        expect(pages.length).toBeGreaterThan(2);
        expect(pages.map((page) => page.content).join("")).toBe(source);
        const segments = pages.flatMap((page) => page.renderPlan?.segments ?? []);
        expect(segments.map((segment) => source.slice(segment.sourceStart, segment.sourceEnd)).join(""))
            .toBe(source);
        expect(segments.map((segment) => plan?.renderText?.(segment.sourceStart, segment.sourceEnd)).join(""))
            .toBe(visibleText(source));
        for (const annotation of annotations) {
            expect(pages.filter((page) => page.content.includes(annotation))).toHaveLength(1);
        }
    });

    it("keeps a short inline HTML annotation and quoted tag punctuation unchanged", async () => {
        const source = "Before<sub title='Page > location < next'>:\u200a16</sub>After";
        const plan = createShareCardFragmentBoundaryPlan(source);
        expect(plan?.renderText?.(0, source.length)).toBe("Before:\u200a16After");
        await expect(paginateShareCardMarkdown([source], () => true)).resolves.toEqual([
            { pageIndex: 0, totalPages: 1, content: source },
        ]);
    });

    it.each([
        "<sup><span title=\"Page 11\">:11</span>",
        "<sup><span>:11</sup></span>",
        "<div>:11</div>",
        "<sup><em>:11</em></sup>",
        "<sup>&thinsp;11</sup>",
        "<sup>**11**</sup>",
        "<sup hidden>:11</sup>",
        "<span style=\"display:none\">:11</span>",
        `${"<span>".repeat(65)}11${"</span>".repeat(65)}`,
    ])("rejects unsupported inline HTML boundaries: %s", (annotation) => {
        const source = `${"Before ".repeat(30)}${annotation}${" After".repeat(30)}`;
        expect(createShareCardFragmentBoundaryPlan(source)).toBeNull();
    });

    it("reports an unpageable error when unsupported inline HTML must split", async () => {
        const source = `${"Before ".repeat(30)}<sup hidden>:11</sup>${" After".repeat(30)}`;
        await expect(paginateShareCardMarkdown([source], (markdown) => markdown.length < 100))
            .rejects.toMatchObject({ code: "unpageable-content" });
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

    it("bounds dense-code-point sentinels without bounding page count", async () => {
        const original = "甲".repeat(60_000);
        const boundaryPlan = createShareCardFragmentBoundaryPlan(original);

        expect(boundaryPlan).not.toBeNull();
        expect(boundaryPlan?.insertions.length).toBeLessThanOrEqual(
            MAX_SHARE_CARD_FRAGMENT_BOUNDARIES,
        );
        const pages = await paginateShareCardMarkdown(
            [original],
            (markdown) => Array.from(markdown).length <= 2_000,
        );
        expect(pages.length).toBeGreaterThan(1);
        expect(pages.length).toBeGreaterThan(24);
        expect(pages.map((page) => page.content).join("")).toBe(original);
        const instrumentedOffsets = new Set(boundaryPlan?.boundaries ?? []);
        for (const segment of pages.flatMap((page) => page.renderPlan?.segments ?? [])) {
            if (segment.sourceStart > 0) expect(instrumentedOffsets.has(segment.sourceStart)).toBe(true);
            if (segment.sourceEnd < original.length) {
                expect(instrumentedOffsets.has(segment.sourceEnd)).toBe(true);
            }
        }
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
        ["bold italic with asterisks", "***", "***"],
        ["bold italic with underscores", "___", "___"],
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

    it("keeps inline bold italic text ordered across a long paragraph", async () => {
        const emphasized = `${"bold italic ".repeat(23)}bold italic`;
        const source = `Synthetic ${"taxonomy ".repeat(24)}***${emphasized}*** tail`;
        const pages = await paginateShareCardMarkdown(
            [source],
            (markdown) => markdown.length <= 40,
        );
        const segments = pages.flatMap((page) => page.renderPlan?.segments ?? []);

        expect(pages.length).toBeGreaterThan(1);
        expect(pages.some((page) => page.content.split("***").length - 1 === 2))
            .toBe(true);
        expect(pages.every((page) => {
            const markerCount = page.content.split("***").length - 1;
            return markerCount === 0 || markerCount === 2;
        })).toBe(true);
        expect(segments.map((segment) => (
            source.slice(segment.sourceStart, segment.sourceEnd)
        )).join("")).toBe(source);
        expect(segments.map((segment) => segment.sourceStart)).toEqual([
            ...segments.map((segment) => segment.sourceStart),
        ].sort((left, right) => left - right));
    });

    it("uses literal sentinels for fragment boundaries inside inline code", () => {
        const source = `before \`${"code ".repeat(20)}\` after`;
        const plan = createShareCardFragmentBoundaryPlan(source);
        const codeStart = source.indexOf("`") + 1;
        const codeEnd = source.lastIndexOf("`");
        const codeInsertions = plan?.insertions.filter((insertion) => (
            insertion.sourceOffset > codeStart && insertion.sourceOffset < codeEnd
        ));

        expect(codeInsertions?.length).toBeGreaterThan(0);
        expect(codeInsertions?.every((insertion) => insertion.kind === "literal")).toBe(true);
    });

    it("splits task lists only between complete task items", async () => {
        const first = "- [ ] first task";
        const second = "- [x] second task";
        const source = `${first}\n${second}`;
        const secondStart = first.length + 1;
        const plan = createShareCardFragmentBoundaryPlan(source);

        expect(plan?.boundaries).toEqual([secondStart]);
        expect(plan?.insertions).toEqual([{
            insertionOffset: secondStart + "- [x] ".length,
            kind: "element",
            snap: "list-item-start",
            sourceOffset: secondStart,
        }]);

        const pages = await paginateShareCardMarkdown(
            [source],
            (markdown) => markdown.length <= first.length + 1,
        );
        expect(pages.map((page) => page.content)).toEqual([`${first}\n`, second]);
    });

    it("fails closed for one oversized task item", async () => {
        const task = `- [ ] ${"single task content ".repeat(12)}`;

        await expect(paginateShareCardMarkdown(
            [task],
            (markdown) => markdown.length <= 40,
        )).rejects.toMatchObject({ code: "unpageable-content" });
    });

    it("keeps nested child items inside their parent task atomic scope", async () => {
        const parent = "- [ ] parent task";
        const childTask = "  - [x] nested task";
        const childOrdinary = "  - nested ordinary";
        const source = [parent, childTask, childOrdinary].join("\n");
        const plan = createShareCardFragmentBoundaryPlan(source);

        expect(plan?.boundaries).toEqual([]);
        await expect(paginateShareCardMarkdown(
            [source],
            (markdown) => markdown.length <= parent.length + 1,
        )).rejects.toMatchObject({ code: "unpageable-content" });
    });

    it("does not expose a nested task boundary under an ordinary parent", () => {
        const parent = "- ordinary parent";
        const child = "  - [ ] nested task";
        const childStart = parent.length + 1;
        const plan = createShareCardFragmentBoundaryPlan(`${parent}\n${child}`);

        expect(plan?.boundaries).not.toContain(childStart);
        expect(plan?.insertions.some((insertion) => insertion.sourceOffset === childStart))
            .toBe(false);
    });

    it("allows a task to paginate before a proven ordinary sibling", async () => {
        const task = "- [ ] complete task";
        const ordinary = "- ordinary sibling";
        const source = `${task}\n${ordinary}`;
        const siblingStart = task.length + 1;
        const plan = createShareCardFragmentBoundaryPlan(source);
        const siblingBoundary = plan?.insertions.find((insertion) => (
            insertion.sourceOffset === siblingStart
        ));

        expect(siblingBoundary).toMatchObject({
            kind: "element",
            snap: "list-item-start",
            sourceOffset: siblingStart,
        });
        const pages = await paginateShareCardMarkdown(
            [source],
            (markdown) => markdown.length <= task.length + 1,
        );
        expect(pages.map((page) => page.content)).toEqual([`${task}\n`, ordinary]);
    });

    it("snaps an intro boundary before the first item of a new list", async () => {
        const intro = "intro";
        const item = "- first";
        const source = `${intro}\n${item}`;
        const itemStart = intro.length + 1;
        const plan = createShareCardFragmentBoundaryPlan(source);

        expect(plan?.insertions.find((insertion) => insertion.sourceOffset === itemStart))
            .toMatchObject({ snap: "list-item-start" });
        const pages = await paginateShareCardMarkdown(
            [source],
            (markdown) => markdown.length <= item.length + 1,
        );
        expect(pages.map((page) => page.content)).toEqual([`${intro}\n`, item]);
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

    it("keeps punctuation-adjacent italic links ordered across a long paragraph", async () => {
        const source = `${"Prefix ".repeat(20)}*[tapetum lucidum](https://example.com/Tapetum_lucidum "Tapetum lucidum")*, suffix. (*[Actinidia polygama](https://example.com/Actinidia_polygama "Actinidia polygama")*) and (*[Species name](https://example.com/species)*)${" tail".repeat(20)}`;
        const linkPattern = /\*\[([^\]]+)\]\((https:\/\/example\.com\/[^)]+)\)\*/gu;
        const visible = (markdown: string): string => markdown.replace(linkPattern, "$1");
        const plan = createShareCardFragmentBoundaryPlan(source);
        expect(plan).not.toBeNull();
        expect(plan?.renderText?.(0, source.length)).toBe(visible(source));
        const pages = await paginateShareCardMarkdown([source], (markdown) => markdown.length <= 150);
        const segments = pages.flatMap((page) => page.renderPlan?.segments ?? []);

        expect(pages.length).toBeGreaterThan(2);
        expect(pages.map((page) => visible(page.content)).join("")).toBe(visible(source));
        expect(pages.every((page) => !/[*\[\]]/u.test(visible(page.content)))).toBe(true);
        expect(segments.map((segment) => source.slice(segment.sourceStart, segment.sourceEnd)).join(""))
            .toBe(source);
        expect(segments.map((segment) => plan?.renderText?.(segment.sourceStart, segment.sourceEnd)).join(""))
            .toBe(visible(source));
    });

    it.each(["*", "**", "***"])("repeats exact %s link wrappers at label page boundaries", async (marker) => {
        const label = Array.from({ length: 14 }, (_, index) => `species-${index}`).join(" ");
        const source = `(${marker}[${label}](https://e.x "L")${marker})`;
        const plan = createShareCardFragmentBoundaryPlan(source);
        expect(plan?.renderText?.(0, source.length)).toBe(`(${label})`);
        const pages = await paginateShareCardMarkdown([source], (markdown) => markdown.length <= 65);
        const segments = pages.flatMap((page) => page.renderPlan?.segments ?? []);

        expect(pages.length).toBeGreaterThan(1);
        for (const page of pages) {
            expect(page.content).toContain(`${marker}[`);
            expect(page.content).toContain(`](https://e.x "L")${marker}`);
        }
        expect(segments.map((segment) => source.slice(segment.sourceStart, segment.sourceEnd)).join(""))
            .toBe(source);
        expect(segments.map((segment) => plan?.renderText?.(segment.sourceStart, segment.sourceEnd)).join(""))
            .toBe(`(${label})`);
    });

    it.each([
        "(*[label](https://e.x)",
        "(*[label](https://e.x)**)",
        "(****[label](https://e.x)****)",
        "(*[label](https://e.x) more text*)",
        "(*[label][ref]*)",
        "(*[label][]*)",
        "(*[outer *[inner](https://e.x)*](https://e.y)*)",
        "**outer(**[label](https://e.x)**)**",
    ])("rejects unsupported emphasis/link boundaries: %s", (fragment) => {
        const source = `${"before ".repeat(12)}${fragment}${" after".repeat(12)}`;
        expect(createShareCardFragmentBoundaryPlan(source)).toBeNull();
    });

    it("reports an unpageable error when unsupported emphasis/link content must split", async () => {
        const source = `${"before ".repeat(12)}(*[label][ref]*)${" after".repeat(12)}`;
        await expect(paginateShareCardMarkdown([source], (markdown) => markdown.length <= 60))
            .rejects.toMatchObject({ code: "unpageable-content" });
    });

    it("keeps reference-link definitions as invisible context across page boundaries", async () => {
        const original = "[label][ref]\n[ref]: https://e.x";

        const fragmented = await paginateShareCardMarkdown(
            [original],
            (markdown) => markdown.length <= 20,
        );
        const separateBlocks = await paginateShareCardMarkdown(
            ["[label][ref]", "[ref]: https://e.x"],
            (markdown) => markdown.length <= 20,
        );

        expect(fragmented).toEqual([
            { pageIndex: 0, totalPages: 1, content: original },
        ]);
        expect(separateBlocks).toEqual([{
            pageIndex: 0,
            totalPages: 1,
            content: "[label][ref]\n\n[ref]: https://e.x",
        }]);
        expect(fragmented.every((page) => page.content.trim().length > 0)).toBe(true);
        expect(JSON.stringify(fragmented)).not.toContain("renderPlan");

        await expect(paginateShareCardMarkdown(
            [original],
            () => true,
        )).resolves.toEqual([
            { pageIndex: 0, totalPages: 1, content: original },
        ]);
    });

    it("keeps projected footnotes out of per-block reference context while preserving ordinary links", () => {
        const prepared = prepareShareCardMarkdown([
            "First body references [^note] and [ordinary link][link].",
            "",
            "Second body references the same [^note].",
            "",
            "[^note]: One complete endnote detail.",
            "",
            "[link]: https://example.com/article",
        ].join("\n"));
        const context = createShareCardReferenceDefinitionContext(prepared.blocks);
        const contextualBlocks = prepared.blocks.map((block) => (
            applyShareCardReferenceDefinitionContext(block, context)
        ));
        const contextualMarkdown = contextualBlocks.join("\n\n");

        expect(context.definitions.has("^note")).toBe(false);
        expect(context.definitions.get("link")).toBe("[link]: https://example.com/article");
        expect(contextualMarkdown.split("One complete endnote detail.")).toHaveLength(2);
        expect(contextualBlocks[0]).toContain("First body references \\[1\\]");
        expect(contextualBlocks[0]).toContain("[link]: https://example.com/article");
        expect(contextualBlocks[0]).not.toContain("One complete endnote detail.");
    });

    it("paginates a complete projected long endnote after the body under a synthetic text-length fit", async () => {
        const footnoteWords = Array.from({ length: 70 }, (_, index) => (
            `detail${String(index).padStart(3, "0")}`
        ));
        const prepared = prepareShareCardMarkdown([
            "First body uses [^long].",
            "",
            "Final body repeats [^long]. END_OF_BODY.",
            "",
            `[^long]: ${footnoteWords.join(" ")}`,
        ].join("\n"));
        const pages = await paginateShareCardMarkdown(
            prepared.blocks,
            (markdown) => markdown.length <= 120,
        );
        const allMarkdown = pages.map((page) => page.content).join("\n\n");
        const footnoteBlockIndex = prepared.blocks.findIndex((block) => block.includes("detail000"));
        const footnoteBlock = prepared.blocks[footnoteBlockIndex] ?? "";
        const sourceSegments = pages.flatMap((page) => page.renderPlan?.segments ?? [])
            .filter((segment) => segment.blockIndex === footnoteBlockIndex);

        expect(pages.length).toBeGreaterThan(2);
        expect(pages.every((page) => page.content.trim().length > 0 && page.content.length <= 120))
            .toBe(true);
        expect(allMarkdown.indexOf("detail000")).toBeGreaterThan(allMarkdown.indexOf("END_OF_BODY."));
        expect(allMarkdown).toContain("First body uses \\[1\\].");
        expect(allMarkdown).toContain("Final body repeats \\[1\\].");
        expect(allMarkdown).not.toContain("[^long]");
        expect(allMarkdown.match(/\bdetail\d{3}\b/gu)).toEqual(footnoteWords);
        expect(pages.filter((page) => /\bdetail\d{3}\b/u.test(page.content)).length)
            .toBeGreaterThan(1);
        expect(sourceSegments.map((segment) => (
            footnoteBlock.slice(segment.sourceStart, segment.sourceEnd)
        )).join("")).toBe(footnoteBlock);
        expect(pages.map((page) => page.pageIndex)).toEqual(pages.map((_, index) => index));
        expect(pages.every((page) => page.totalPages === pages.length)).toBe(true);
    });

    it("keeps reference-image definitions as invisible context without a blank page", async () => {
        const use = "![chart][image]";
        const definition = "[image]: data:image/png;base64,AAAA";
        const pages = await paginateShareCardMarkdown(
            [use, definition],
            (markdown) => markdown !== `${use}\n\n${definition}`,
        );

        expect(pages).toEqual([{
            pageIndex: 0,
            totalPages: 1,
            content: `${use}\n\n${definition}`,
        }]);
    });

    it("builds invisible per-block definition context without reading code literals", () => {
        const definition = "[ref]: https://example.com/reference";
        const context = createShareCardReferenceDefinitionContext([
            "[label][ref]",
            definition,
            "```md\n[code]: https://example.com/code\n```",
            "<pre>\n[raw]: https://example.com/raw\n</pre>",
        ]);

        expect([...context.definitions.keys()]).toEqual(["ref"]);
        expect(applyShareCardReferenceDefinitionContext("[label][ref]", context))
            .toBe(`[label][ref]\n\n${definition}`);
        expect(applyShareCardReferenceDefinitionContext(
            "```md\n[label][ref]\n```",
            context,
        )).toBe("```md\n[label][ref]\n```");
        expect(applyShareCardReferenceDefinitionContext(
            "`[label][ref]`",
            context,
        )).toBe("`[label][ref]`");
    });

    it.each([
        ["blockquote", "> "],
        ["list", "- "],
    ])("keeps a separated reference definition inside a %s", async (
        _label,
        prefix,
    ) => {
        const pages = await paginateShareCardMarkdown(
            [`${prefix}[label][ref]`, `${prefix}[ref]: https://e.x`],
            (markdown) => markdown.length <= 24,
        );
        expect(pages).toEqual([{
            pageIndex: 0,
            totalPages: 1,
            content: `${prefix}[label][ref]\n\n${prefix}[ref]: https://e.x`,
        }]);
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

    it("keeps context for a reference use after an unmatched literal backtick run", async () => {
        const pages = await paginateShareCardMarkdown(
            ["` unmatched [label][ref]", "[ref]: https://e.x"],
            (markdown) => markdown.length <= 28,
        );
        expect(pages).toEqual([{
            pageIndex: 0,
            totalPages: 1,
            content: "` unmatched [label][ref]\n\n[ref]: https://e.x",
        }]);
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
            `${"prefix ".repeat(6)}a*b*c`,
            `**${"mismatched ".repeat(8)}*`,
            `***${"mismatched ".repeat(8)}**`,
            `___${"mismatched ".repeat(8)}__`,
            `***${"unpaired ".repeat(8)}`,
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

    it("keeps trailing whitespace with visible text instead of creating an empty final page", async () => {
        const pages = await paginateShareCardMarkdown(
            ["abc  "],
            (markdown) => markdown.length <= 3,
        );
        expect(pages.map((page) => page.content).join("")).toBe("abc  ");
        expect(pages.every((page) => page.content.length <= 3 && page.content.trim().length > 0))
            .toBe(true);
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

    it("keeps a mixed representative batch beyond both retired limits complete", async () => {
        const filler = "Share Card keeps every ordered source character. ".repeat(21);
        const textBlocks = Array.from({ length: 48 }, (_, index) => (
            `## Complete section ${index + 1}\n\n${filler}Section ${index + 1} continues.`
        ));
        const blocks = [
            "# Complete long Share Card",
            "![visual](data:image/png;base64,AAAA)",
            "- first ordered item\n- second ordered item\n- final list item",
            "> The quotation remains in source order.",
            "```ts\nconst orderedSource = true;\n```",
            ...textBlocks,
            "The final sentence remains exactly intact.",
        ];
        const expected = blocks.join("\n\n");

        expect(expected.length).toBeGreaterThan(50_000);
        const pages = await paginateShareCardMarkdown(
            blocks,
            (markdown) => markdown.length <= 1_200,
        );

        expect(pages.length).toBeGreaterThan(24);
        expect(pages.every((page) => page.content.trim().length > 0)).toBe(true);
        expect(pages.map((page) => page.content).join("\n\n")).toBe(expected);
        expect(pages[pages.length - 1]?.content.endsWith(
            "The final sentence remains exactly intact.",
        )).toBe(true);
        expect(pages.map(({ pageIndex, totalPages }) => ({ pageIndex, totalPages }))).toEqual(
            pages.map((_, index) => ({ pageIndex: index, totalPages: pages.length })),
        );
    });

    it("refines long-block boundaries on demand without a whole-block sentinel cap", async () => {
        const source = "甲".repeat(250_000);
        const requestedRanges: Array<[number, number]> = [];
        const recordedBoundaries = new Set<number>();
        for (const boundary of createShareCardFragmentBoundaryPlan(source)?.boundaries ?? []) {
            recordedBoundaries.add(boundary);
        }
        const refineBoundaries = jest.fn(async (
            _blockIndex: number,
            start: number,
            end: number,
        ) => {
            requestedRanges.push([start, end]);
            const boundaries: number[] = [];
            for (let offset = start + 1; offset < end; offset += 1) {
                boundaries.push(offset);
                recordedBoundaries.add(offset);
            }
            return boundaries;
        });

        const pages = await paginateShareCardMarkdown(
            [source],
            (markdown) => markdown.length <= 100,
            { refineBoundaries } as unknown as ShareCardPaginationOptions,
        );

        expect(pages.length).toBeGreaterThan(24);
        expect(pages.every((page) => page.content.length > 0)).toBe(true);
        expect(pages.map((page) => page.content).join("")).toBe(source);
        expect(pages[pages.length - 1]?.content.endsWith("甲")).toBe(true);
        expect(refineBoundaries.mock.calls.length).toBeGreaterThan(1);
        expect(requestedRanges.at(-1)?.[1]).toBeLessThanOrEqual(source.length);
        const plannedSegments = pages.flatMap((page) => page.renderPlan?.segments ?? []);
        for (const segment of plannedSegments) {
            if (segment.sourceStart > 0) {
                expect(recordedBoundaries.has(segment.sourceStart)).toBe(true);
            }
            if (segment.sourceEnd < source.length) {
                expect(recordedBoundaries.has(segment.sourceEnd)).toBe(true);
            }
        }
    });

    it("reports cancellation without calling it a measurement failure", async () => {
        const controller = new AbortController();
        const fits = jest.fn(() => {
            controller.abort();
            return true;
        });

        await expect(paginateShareCardMarkdown(
            ["one"],
            fits,
            { signal: controller.signal, yieldToPlatform: async () => undefined },
        )).rejects.toBeInstanceOf(ShareCardPaginationCancelledError);
        expect(fits).toHaveBeenCalledTimes(1);
    });

    it("cancels a pending platform yield before the next measurement", async () => {
        const controller = new AbortController();
        const fits = jest.fn((markdown: string) => markdown.length <= 1);
        const yieldToPlatform = jest.fn(async () => {
            if (fits.mock.calls.length >= 3) {
                controller.abort();
                return new Promise<void>(() => undefined);
            }
        });

        await expect(paginateShareCardMarkdown(
            ["a", "b", "c"],
            fits,
            { signal: controller.signal, yieldToPlatform },
        )).rejects.toBeInstanceOf(ShareCardPaginationCancelledError);
        expect(yieldToPlatform).toHaveBeenCalledTimes(4);
        expect(fits).toHaveBeenCalledTimes(3);
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
