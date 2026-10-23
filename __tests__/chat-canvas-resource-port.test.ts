import { describe, expect, it, jest } from "@jest/globals";
import { TFile, type App, type CachedMetadata } from "obsidian";
import type { SourceAccess } from "../src/plugin/source-access";
import { canvasEmbedMarkdown, createCanvasPreviewResourcePort } from "../src/chat/canvas/canvas-resource-port";
import { scanShareCardResourceReferences } from "../src/share-card/share-card-resources";

jest.mock("obsidian", () => ({
    TFile: class {
        path = "";
        extension = "";
        stat = { mtime: 1, size: 1 };
    },
    resolveSubpath: (_cache: CachedMetadata, subpath: string) => ({
        start: { offset: 0, line: 0, col: 0 }, end: null, list: null, text: subpath,
    }),
}));

function fixture() {
    const files = new Map<string, TFile>();
    for (const path of ["A/image.png", "B/image.png", "A/note.md", "A/sample.pdf", "A/child.canvas"]) {
        files.set(path, Object.assign(new TFile(), {
            path, extension: path.split(".").pop()!, stat: { mtime: 1, size: 1 },
        }));
    }
    const allowed = new Set(files.keys());
    const markdown = new Map([["A/note.md", "Note: [own link](./other.md)\n![](./image.png)"]]);
    const generateMarkdownLink = jest.fn((file: TFile, _sourcePath: string, subpath = "", alias?: string) =>
        "[[" + file.path + subpath + (alias ? "|" + alias : "") + "]]");
    const cachedRead = jest.fn(async () => "");
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            cachedRead,
        },
        metadataCache: {
            getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
                const normalized = linkpath.replace(/^\.\//, "");
                if (files.has(normalized)) return files.get(normalized)!;
                const base = sourcePath.split("/").slice(0, -1).join("/");
                return files.get(base ? base + "/" + normalized : normalized)
                    ?? [...files.values()].find(file => file.path.split("/").pop() === normalized)
                    ?? null;
            },
            getFileCache: () => null,
        },
        fileManager: { generateMarkdownLink },
    } as unknown as App;
    const capture = jest.fn(async (path: string, isPathAllowed: (path: string) => boolean) => {
        if (!isPathAllowed(path) || !markdown.has(path)) return null;
        const file = files.get(path)!;
        return { path, markdown: markdown.get(path)!, mtime: file.stat.mtime, size: file.stat.size };
    });
    const sourceAccess = {
        isDataBoundaryAllowedPath: (path: string) => allowed.has(path),
        isDataBoundaryAllowedFile: (file: TFile) => allowed.has(file.path),
        captureLatestMemorySource: capture,
        getLatestDataBoundaryContentBoundary: () => ({ allowed: true, tags: [], isGenerated: false }),
    } as unknown as SourceAccess;
    const port = createCanvasPreviewResourcePort({ app, sourceAccess });
    return { app, sourceAccess, port, files, allowed, markdown, generateMarkdownLink, cachedRead, capture };
}

describe("Canvas resource display boundary", () => {
    it("uses the native empty text context while retaining each embedded note's own source", async () => {
        const { port, generateMarkdownLink } = fixture();
        const markdown = "Top image: ![](./image.png)\n\n![[A/note.md]]";
        const projection = await port.prepareMarkdown({ markdown, sourcePath: "", isCurrent: () => true });

        expect(projection.sourcePath).toBe("");
        expect(projection.markdown).toContain("![](./image.png)");
        expect(projection.unavailableCount).toBe(0);
        const note = projection.slots[0];
        expect(note.kind).toBe("markdown");
        if (note.kind !== "markdown") throw new Error("Expected embedded note slot.");
        expect(note.sourcePath).toBe("A/note.md");
        expect(note.prepared.sourcePath).toBe("A/note.md");
        expect(note.prepared.markdown).toContain("[own link](./other.md)");
        expect(note.prepared.markdown).toContain("![](./image.png)");
        expect(projection.markdown).not.toContain("own link");
        expect(generateMarkdownLink).not.toHaveBeenCalled();
    });

    it("keeps native local and remote image syntax even when the local image is excluded as an Agent source", async () => {
        const { port, allowed, capture, cachedRead } = fixture();
        allowed.delete("A/image.png");
        const markdown = "![local](A/image.png)\n![[A/image.png|240]]\n"
            + "> ![quoted][picture]\n>\n> [picture]: A/image.png\n\n"
            + "![remote][remote]\n\n[remote]:\n  https://example.test/image.png\n\n"
            + "![inline](https://example.test/inline.png)\n![data](data:image/png;base64,AA==)\n"
            + "<img src=\"https://example.test/html.png\" width=\"120\">";
        const projection = await port.prepareMarkdown({ markdown, sourcePath: "", isCurrent: () => true });

        expect(projection.markdown).toBe(markdown);
        expect(projection.slots).toEqual([]);
        expect(projection.unavailableCount).toBe(0);
        expect(capture).not.toHaveBeenCalled();
        expect(cachedRead).not.toHaveBeenCalled();
    });

    it("keeps quoted and multiline reference-style note embeds behind their existing source boundary", async () => {
        const { port, allowed, capture } = fixture();
        allowed.delete("A/note.md");
        const projection = await port.prepareMarkdown({
            markdown: "> ![quoted][note]\n>\n> [note]: A/note.md\n\n"
                + "![multiline][straße]\n\n[straße]:\n  A/note.md",
            sourcePath: "",
            isCurrent: () => true,
        });

        expect(projection.unavailableCount).toBe(2);
        expect(projection.slots.map(slot => slot.kind)).toEqual(["unavailable", "unavailable"]);
        expect(projection.markdown).not.toContain("![quoted]");
        expect(projection.markdown).not.toContain("![multiline]");
        expect(capture).not.toHaveBeenCalled();
    });

    it("uses the same image exception for file nodes and backgrounds while requiring a current vault file", async () => {
        const { app, port, allowed, files } = fixture();
        allowed.delete("A/image.png");
        const image = files.get("A/image.png")!;
        const request = { reference: "A/image.png", sourcePath: "", isCurrent: () => true };
        expect(await port.resolve(request)).toEqual({ status: "file", file: image, subpath: "" });

        files.delete(image.path);
        app.metadataCache.getFirstLinkpathDest = () => image;
        expect(await port.resolve(request)).toEqual({ status: "unavailable" });

        image.path = "file:/tmp/external.png";
        files.set(image.path, image);
        expect(await port.resolve(request)).toEqual({ status: "unavailable" });
        const projection = await port.prepareMarkdown({
            markdown: "![](file:/tmp/external.png)", sourcePath: "", isCurrent: () => true,
        });
        expect(projection.unavailableCount).toBe(1);
    });

    it("preserves native subpaths and wiki sizing via the host's link formatter", async () => {
        const { port, generateMarkdownLink } = fixture();
        const projection = await port.prepareMarkdown({
            markdown: "![[A/sample.pdf#page=2|300x200]]",
            sourcePath: "B/canvas.canvas",
            isCurrent: () => true,
        });
        expect(generateMarkdownLink).toHaveBeenCalledWith(
            expect.objectContaining({ path: "A/sample.pdf" }), "B/canvas.canvas", "#page=2", "300x200",
        );
        expect(projection.markdown).toBe("![[A/sample.pdf#page=2|300x200]]");
    });

    it("does not allow generated subpaths or aliases to introduce another resource", () => {
        const { app, files } = fixture();
        const image = files.get("A/image.png")!;
        expect(canvasEmbedMarkdown(app, image, "A/canvas.canvas", "#x]]<img src='https://example.test/injected'>")).toBeNull();
        expect(canvasEmbedMarkdown(app, image, "A/canvas.canvas", "", "x]]![[B/image.png")).toBeNull();
    });

    it("replaces a denied HTML element once, keeps trailing text, and never inserts an untrusted placeholder label", async () => {
        const { port, allowed, capture } = fixture();
        allowed.delete("B/image.png");
        const projection = await port.prepareMarkdown({
            markdown: "before <img src=\"B/image.png\" style=\"background:url(https://example.test/bg.png)\"> after\n"
                + "![[private.md|<img src=\"https://example.test/injected.png\">]]",
            sourcePath: "B/canvas.canvas",
            isCurrent: () => true,
        });
        expect(projection.markdown).toContain("before <span");
        expect(projection.markdown).toContain("</span> after");
        expect(projection.unavailableCount).toBe(2);
        expect(projection.slots.every(slot => slot.kind === "unavailable")).toBe(true);
        expect(projection.markdown).not.toMatch(/example\.test|private\.md|image\.png|<img/);
        expect(capture).not.toHaveBeenCalled();
    });

    it("neutralizes iframe/srcdoc and style imports while retaining native images, literal examples and manual links", async () => {
        const { port } = fixture();
        const fence = String.fromCharCode(96).repeat(3);
        const literal = fence + "html\n<iframe src=\"https://example.test/literal\"></iframe>\n" + fence;
        const projection = await port.prepareMarkdown({
            markdown: "<iframe srcdoc=\"<img src='https://example.test/hidden'>\"></iframe> iframe-tail\n"
                + "<style>@import 'https://example.test/font.css';</style> style-tail\n"
                + "<pre><img src=\"https://example.test/pre-active\"></pre> pre-tail\n"
                + "<code><img src=\"https://example.test/code-active\"></code> code-tail\n"
                + "[manual](https://example.test/manual)\n" + literal,
            sourcePath: "A/canvas.canvas",
            isCurrent: () => true,
        });
        expect(projection.unavailableCount).toBe(2);
        expect(projection.markdown).toContain("iframe-tail");
        expect(projection.markdown).toContain("style-tail");
        expect(projection.markdown).toContain("[manual](https://example.test/manual)");
        expect(projection.markdown).toContain(literal);
        expect(projection.markdown).toContain("pre-tail");
        expect(projection.markdown).toContain("code-tail");
        expect(projection.markdown).toContain("<pre><img src=\"https://example.test/pre-active\"></pre>");
        expect(projection.markdown).toContain("<code><img src=\"https://example.test/code-active\"></code>");
        expect(projection.markdown).not.toMatch(/srcdoc|example\.test\/hidden|@import/);
        expect(scanShareCardResourceReferences("<iframe src=\"https://example.test/x\"></iframe>").references).toEqual([]);
    });

    it("does not recursively read the contents of a native shape-only Canvas embed, and stops note cycles before another read", async () => {
        const { port, markdown, capture, cachedRead } = fixture();
        markdown.set("A/note.md", "![[A/note.md]]\n![[A/child.canvas]]");
        const projection = await port.prepareMarkdown({
            markdown: "![[A/note.md]]",
            sourcePath: "B/canvas.canvas",
            isCurrent: () => true,
        });
        expect(capture).toHaveBeenCalledTimes(1);
        expect(cachedRead).not.toHaveBeenCalled();
        expect(projection.unavailableCount).toBe(1);
        const note = projection.slots[0];
        expect(note.kind).toBe("markdown");
        if (note.kind === "markdown") expect(note.prepared.markdown).toContain("![[A/child.canvas]]");
    });

    it("discards late or newly denied note content after the awaited read", async () => {
        for (const invalidation of ["owner", "policy"] as const) {
            const { port, sourceAccess, allowed } = fixture();
            let finish!: (value: { path: string; markdown: string; mtime: number; size: number }) => void;
            sourceAccess.captureLatestMemorySource = (() => new Promise(resolve => { finish = resolve; })) as SourceAccess["captureLatestMemorySource"];
            let current = true;
            const pending = port.prepareMarkdown({
                markdown: "![[A/note.md]]", sourcePath: "B/canvas.canvas", isCurrent: () => current,
            });
            if (invalidation === "owner") current = false;
            else allowed.delete("A/note.md");
            finish({ path: "A/note.md", markdown: "Private late content", mtime: 1, size: 1 });
            const result = await pending;
            expect(result.unavailableCount).toBeGreaterThan(0);
            expect(result.markdown).not.toContain("Private late content");
            expect(result.slots.every(slot => slot.kind === "unavailable")).toBe(true);
        }
    });
});
