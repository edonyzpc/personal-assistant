/* Copyright 2023 edonyzpc */

import { describe, expect, it, jest } from "@jest/globals";
import type { App, CachedMetadata } from "obsidian";
import {
    ShareCardResourceAbortedError,
    createShareCardResourceCache,
    localizeShareCardResources,
    type ShareCardRequestUrl,
} from "../src/share-card/share-card-resources";

interface TestVaultFile {
    path: string;
    extension: string;
    binary?: ArrayBuffer;
    markdown?: string;
    cache?: CachedMetadata;
    stat?: { size: number };
}

function bytes(value: string): ArrayBuffer {
    return new TextEncoder().encode(value).buffer;
}

function prefixedBytes(prefix: readonly number[], suffix = ""): ArrayBuffer {
    const tail = new TextEncoder().encode(suffix);
    const result = new Uint8Array(prefix.length + tail.byteLength);
    result.set(prefix);
    result.set(tail, prefix.length);
    return result.buffer;
}

function pngBytes(suffix = ""): ArrayBuffer {
    return prefixedBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], suffix);
}

function jpegBytes(suffix = ""): ArrayBuffer {
    return prefixedBytes([0xff, 0xd8, 0xff], suffix);
}

function gifBytes(suffix = ""): ArrayBuffer {
    return prefixedBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], suffix);
}

function webpBytes(suffix = ""): ArrayBuffer {
    return prefixedBytes([
        0x52, 0x49, 0x46, 0x46,
        0x00, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50,
    ], suffix);
}

function imageResponse(
    body: ArrayBuffer = pngBytes(),
    mimeType = "image/png",
): { status: number; headers: Record<string, string>; arrayBuffer: ArrayBuffer } {
    return {
        status: 200,
        headers: { "Content-Type": mimeType },
        arrayBuffer: body,
    };
}

function location(offset: number) {
    return { line: 0, col: offset, offset };
}

function makeApp(files: Record<string, TestVaultFile> = {}) {
    for (const file of Object.values(files)) {
        file.stat ??= {
            size: file.binary?.byteLength ?? bytes(file.markdown ?? "").byteLength,
        };
    }
    const getFirstLinkpathDest = jest.fn((linkpath: string, _sourcePath: string) => (
        files[linkpath] ?? null
    ));
    const getFileCache = jest.fn((file: TestVaultFile) => file.cache ?? null);
    const getAbstractFileByPath = jest.fn((path: string) => (
        Object.values(files).find((file) => file.path === path) ?? null
    ));
    const readBinary = jest.fn(async (file: TestVaultFile) => file.binary ?? new ArrayBuffer(0));
    const cachedRead = jest.fn(async (file: TestVaultFile) => file.markdown ?? "");
    const getFiles = jest.fn(() => Object.values(files));
    return {
        app: {
            metadataCache: { getFirstLinkpathDest, getFileCache },
            vault: { readBinary, cachedRead, getAbstractFileByPath, getFiles },
        } as unknown as App,
        cachedRead,
        getFileCache,
        getAbstractFileByPath,
        getFirstLinkpathDest,
        readBinary,
        getFiles,
    };
}

describe("Share Card resource localization", () => {
    it("localizes explicit Markdown, raw img, SVG, and inline CSS remote images without a proxy", async () => {
        const { app } = makeApp();
        const payload = pngBytes("remote");
        const request = jest.fn<ShareCardRequestUrl>(async () => imageResponse(payload));
        const url = "https://cdn.example.test/image.png";
        const markdown = [
            `![Markdown](${url})`,
            `<img src="${url}">`,
            `<svg><image href="${url}"></image></svg>`,
            `<div style="background-image: url('${url}')">Visual</div>`,
        ].join("\n");

        const result = await localizeShareCardResources(app, markdown, {
            cache: createShareCardResourceCache(),
        }, { requestUrl: request });

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith({ url, method: "GET", throw: false });
        expect(result.markdown).not.toContain("https://");
        expect(result.markdown.match(/data:image\/png;base64/g)).toHaveLength(4);
        expect(result.report).toMatchObject({
            complete: true,
            resolvedCount: 4,
            placeholderCount: 0,
            failedCount: 0,
            uniqueResourceCount: 1,
            totalResolvedBytes: payload.byteLength,
        });
    });

    it("resolves only explicit Vault images with source-aware MetadataCache and readBinary", async () => {
        const first = {
            path: "Assets/photo.png",
            extension: "png",
            binary: pngBytes("first"),
        };
        const second = {
            path: "Assets/other.jpg",
            extension: "jpg",
            binary: jpegBytes("second"),
        };
        const { app, getFirstLinkpathDest, readBinary, getFiles } = makeApp({
            "Assets/photo.png": first,
            "../Assets/other.jpg": second,
        });
        const request = jest.fn<ShareCardRequestUrl>();

        const result = await localizeShareCardResources(
            app,
            "![[Assets/photo.png|300]]\n![Other](../Assets/other.jpg)",
            { resourceBasePath: "Notes/source.md" },
            { requestUrl: request },
        );

        expect(getFirstLinkpathDest).toHaveBeenNthCalledWith(
            1,
            "Assets/photo.png",
            "Notes/source.md",
        );
        expect(getFirstLinkpathDest).toHaveBeenNthCalledWith(
            2,
            "../Assets/other.jpg",
            "Notes/source.md",
        );
        expect(readBinary).toHaveBeenCalledTimes(2);
        expect(readBinary).toHaveBeenNthCalledWith(1, first);
        expect(readBinary).toHaveBeenNthCalledWith(2, second);
        expect(getFiles).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
        expect(result.markdown).toContain("data:image/png;base64");
        expect(result.markdown).toContain("data:image/jpeg;base64");
        expect(result.report.complete).toBe(true);
    });

    it("expands a full Markdown note, removes frontmatter, localizes nested resources, and preserves host order", async () => {
        const frontmatter = "---\ntitle: Hidden\n---\n";
        const noteMarkdown = `${frontmatter}# Embedded\nNested ![[../Assets/nested.png]]`;
        const note = {
            path: "Notes/Embedded.md",
            extension: "md",
            markdown: noteMarkdown,
            cache: {
                frontmatterPosition: {
                    start: location(0),
                    end: location(frontmatter.length - 1),
                },
            },
        };
        const nested = {
            path: "Assets/nested.png",
            extension: "png",
            binary: pngBytes("nested"),
        };
        const { app, cachedRead, getFirstLinkpathDest, readBinary } = makeApp({
            "Notes/Embedded.md": note,
            "../Assets/nested.png": nested,
        });

        const result = await localizeShareCardResources(
            app,
            "Before![[Notes/Embedded.md|Embedded note]]After",
            { resourceBasePath: "Notes/Source.md" },
        );

        expect(result.markdown).not.toContain("title: Hidden");
        expect(result.markdown).toMatch(/Before\n\n# Embedded[\s\S]*data:image\/png;base64[\s\S]*\n\nAfter/);
        expect(result.markdown.indexOf("Before")).toBeLessThan(result.markdown.indexOf("# Embedded"));
        expect(result.markdown.indexOf("# Embedded")).toBeLessThan(result.markdown.indexOf("After"));
        expect(getFirstLinkpathDest).toHaveBeenNthCalledWith(
            1,
            "Notes/Embedded.md",
            "Notes/Source.md",
        );
        expect(getFirstLinkpathDest).toHaveBeenNthCalledWith(
            2,
            "../Assets/nested.png",
            "Notes/Embedded.md",
        );
        expect(cachedRead).toHaveBeenCalledTimes(1);
        expect(readBinary).toHaveBeenCalledTimes(1);
        expect(result.report).toMatchObject({
            complete: true,
            resolvedCount: 2,
            placeholderCount: 0,
            uniqueResourceCount: 2,
        });
        expect(result.report.resources[0]).toMatchObject({
            kind: "vault-embed",
            status: "resolved",
            mimeType: "text/markdown",
        });
    });

    it("preserves heading and block anchors and projects their resolveSubpath offset ranges", async () => {
        const markdown = [
            "Intro",
            "## Section",
            "Section body",
            "## Next",
            "Tail",
            "Block body ^block",
        ].join("\n");
        const sectionStart = markdown.indexOf("## Section");
        const sectionEnd = markdown.indexOf("## Next");
        const blockStart = markdown.indexOf("Block body");
        const blockEnd = markdown.length;
        const metadata = {} as CachedMetadata;
        const note = {
            path: "Notes/Target.md",
            extension: "md",
            markdown,
            cache: metadata,
        };
        const { app, cachedRead, getFirstLinkpathDest } = makeApp({
            "Notes/Target.md": note,
        });
        const resolveSubpath = jest.fn((_cache: CachedMetadata, subpath: string) => {
            if (subpath === "#Section") {
                return { start: location(sectionStart), end: location(sectionEnd) };
            }
            if (subpath === "#^block") {
                return { start: location(blockStart), end: location(blockEnd) };
            }
            return null;
        });

        const result = await localizeShareCardResources(
            app,
            "A![[Notes/Target.md#Section]]B![[Notes/Target.md^block]]C",
            { resourceBasePath: "Notes/Source.md" },
            { resolveSubpath: resolveSubpath as typeof import("obsidian").resolveSubpath },
        );

        expect(resolveSubpath).toHaveBeenNthCalledWith(1, metadata, "#Section");
        expect(resolveSubpath).toHaveBeenNthCalledWith(2, metadata, "#^block");
        expect(getFirstLinkpathDest).toHaveBeenNthCalledWith(
            1,
            "Notes/Target.md",
            "Notes/Source.md",
        );
        expect(getFirstLinkpathDest).toHaveBeenNthCalledWith(
            2,
            "Notes/Target.md",
            "Notes/Source.md",
        );
        expect(cachedRead).toHaveBeenCalledTimes(1);
        expect(result.markdown).toContain("## Section\nSection body");
        expect(result.markdown).toContain("Block body ^block");
        expect(result.markdown).not.toContain("Intro");
        expect(result.report.complete).toBe(true);
        expect(result.report.uniqueResourceCount).toBe(1);
    });

    it("uses visible incomplete placeholders for note cycles and depth overflow", async () => {
        const a = { path: "A.md", extension: "md", markdown: "A -> ![[B.md]]" };
        const b = { path: "B.md", extension: "md", markdown: "B -> ![[A.md]]" };
        const cycleApp = makeApp({ "A.md": a, "B.md": b });
        const cycle = await localizeShareCardResources(cycleApp.app, "![[A.md]]");

        expect(cycleApp.cachedRead).toHaveBeenCalledTimes(2);
        expect(cycle.markdown).toContain("data:image/svg+xml");
        expect(cycle.report.complete).toBe(false);
        expect(cycle.report.resources.some(({ failureReason }) => failureReason === "cycle")).toBe(true);

        const depthApp = makeApp({ "A.md": a, "B.md": b });
        const depth = await localizeShareCardResources(
            depthApp.app,
            "![[A.md]]",
            {},
            { limits: { maxEmbedDepth: 1 } },
        );

        expect(depthApp.cachedRead).toHaveBeenCalledTimes(1);
        expect(depth.report.complete).toBe(false);
        expect(depth.report.resources.some(
            ({ failureReason }) => failureReason === "depth-exceeded",
        )).toBe(true);
    });

    it("does zero I/O for multiline code spans, container-indented code, raw-text HTML, and comments", async () => {
        const { app, cachedRead, getFirstLinkpathDest, readBinary } = makeApp();
        const request = jest.fn<ShareCardRequestUrl>(async () => imageResponse());
        const rawTags = [
            "script", "style", "textarea", "title", "xmp", "iframe", "noembed",
            "noframes", "template", "code", "pre",
        ];
        const markdown = [
            "`literal",
            "![multiline](https://literal.test/multiline.png)",
            "`",
            ">     ![[Assets/blockquote.png]]",
            "-     ![list](https://literal.test/list.png)",
            "```md",
            "![fenced](https://literal.test/fenced.png)",
            "```",
            "    ![[Assets/indented.png]]",
            ...rawTags.map((tag) => (
                `<${tag}><img src="https://literal.test/${tag}.png"></${tag}>`
            )),
            "<!-- <img src=\"https://literal.test/comment.png\"> -->",
            "<plaintext><img src=\"https://literal.test/plaintext.png\">",
        ].join("\n");

        const result = await localizeShareCardResources(app, markdown, {}, { requestUrl: request });

        expect(result.markdown).toBe(markdown);
        expect(result.report.resources).toHaveLength(0);
        expect(request).not.toHaveBeenCalled();
        expect(getFirstLinkpathDest).not.toHaveBeenCalled();
        expect(readBinary).not.toHaveBeenCalled();
        expect(cachedRead).not.toHaveBeenCalled();
    });

    it("strictly rejects every non-fragment SVG resource path while preserving static SVG", async () => {
        const { app } = makeApp();
        const unsafeMarkup = [
            '<svg xmlns="http://www.w3.org/2000/svg"><image href="&#x68;ttps://cdn.test/x.png"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(relative.png)"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///tmp/x.png"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><image href="blob:unsafe"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><image href="custom:unsafe"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml,%3Csvg%2F%3E"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><image href=relative.png/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u\\72 l(relative.png)"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><image href="#safe"><set attributeName="href" to="https://cdn.test/x.png"/></image></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:alt="http://www.w3.org/1999/xlink"><image alt:href="https://cdn.test/x.png"/></svg>',
        ];

        for (const [index, markup] of unsafeMarkup.entries()) {
            const result = await localizeShareCardResources(
                app,
                `![Unsafe ${index}](data:image/svg+xml,${encodeURIComponent(markup)})`,
            );
            expect(result.report.resources[0]).toMatchObject({
                status: "placeholder",
                failureReason: "unsafe-svg",
            });
        }

        const safeMarkup = [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
            "<defs><linearGradient id=\"g\"><stop offset=\"0\"/></linearGradient></defs>",
            '<rect width="10" height="10" fill="url(#g)"/>',
            "</svg>",
        ].join("");
        const safe = await localizeShareCardResources(
            app,
            `![Safe](data:image/svg+xml,${encodeURIComponent(safeMarkup)})`,
        );
        expect(safe.report.complete).toBe(true);
        expect(safe.report.resources[0]).toMatchObject({
            status: "resolved",
            mimeType: "image/svg+xml",
        });
    });

    it("fails closed on namespaced href in the SVG parser fallback but keeps ordinary fragments", async () => {
        const { app } = makeApp();
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
        Object.defineProperty(globalThis, "DOMParser", {
            configurable: true,
            value: undefined,
        });
        try {
            const namespaced = [
                '<svg xmlns="http://www.w3.org/2000/svg" xmlns:alt="http://www.w3.org/1999/xlink">',
                '<image alt:href="#local"/>',
                "</svg>",
            ].join("");
            const rejected = await localizeShareCardResources(
                app,
                `![](data:image/svg+xml,${encodeURIComponent(namespaced)})`,
            );
            expect(rejected.report.resources[0].failureReason).toBe("unsafe-svg");

            const ordinary = [
                '<svg xmlns="http://www.w3.org/2000/svg">',
                '<defs><path id="local" d="M0 0h1"/></defs>',
                '<use href="#local"/>',
                "</svg>",
            ].join("");
            const safe = await localizeShareCardResources(
                app,
                `![](data:image/svg+xml,${encodeURIComponent(ordinary)})`,
            );
            expect(safe.report.complete).toBe(true);
        } finally {
            if (descriptor) {
                Object.defineProperty(globalThis, "DOMParser", descriptor);
            } else {
                Reflect.deleteProperty(globalThis, "DOMParser");
            }
        }
    });

    it("sniffs PNG, JPEG, GIF, and WebP magic bytes and rejects a spoofed raster MIME", async () => {
        const { app } = makeApp();
        const fixtures = new Map([
            ["https://cdn.test/a.png", imageResponse(pngBytes(), "image/png")],
            ["https://cdn.test/a.jpg", imageResponse(jpegBytes(), "image/jpeg")],
            ["https://cdn.test/a.gif", imageResponse(gifBytes(), "image/gif")],
            ["https://cdn.test/a.webp", imageResponse(webpBytes(), "image/webp")],
        ]);
        const request = jest.fn<ShareCardRequestUrl>(async ({ url }) => fixtures.get(url)!);
        const valid = await localizeShareCardResources(
            app,
            [...fixtures.keys()].map((url) => `![](${url})`).join("\n"),
            {},
            { requestUrl: request },
        );

        expect(valid.report.complete).toBe(true);
        expect(valid.report.resolvedCount).toBe(4);

        const spoofed = await localizeShareCardResources(
            app,
            "![Spoofed](https://cdn.test/spoofed.png)",
            {},
            { requestUrl: async () => imageResponse(bytes("not png"), "image/png") },
        );
        expect(spoofed.report.resources[0]).toMatchObject({
            status: "placeholder",
            failureReason: "mime-mismatch",
        });
    });

    it("deduplicates Vault aliases by canonical TFile.path across wiki and Markdown syntax", async () => {
        const file = { path: "Assets/shared.png", extension: "png", binary: pngBytes("shared") };
        const { app, readBinary } = makeApp({
            "Alias.png": file,
            "Assets/shared.png": file,
        });

        const result = await localizeShareCardResources(
            app,
            "![[Alias.png]]\n![Same](Assets/shared.png)",
        );

        expect(readBinary).toHaveBeenCalledTimes(1);
        expect(result.report.resolvedCount).toBe(2);
        expect(result.report.uniqueResourceCount).toBe(1);
        expect(result.report.totalResolvedBytes).toBe(file.binary.byteLength);
    });

    it("reuses a per-Modal cache across occurrences and localization passes", async () => {
        const { app } = makeApp();
        const request = jest.fn<ShareCardRequestUrl>(async () => imageResponse(pngBytes("cached")));
        const cache = createShareCardResourceCache();
        const context = { cache };
        const markdown = "![One](https://cdn.example.test/shared.png)\n![Two](https://cdn.example.test/shared.png)";

        const first = await localizeShareCardResources(app, markdown, context, { requestUrl: request });
        const second = await localizeShareCardResources(app, markdown, context, { requestUrl: request });

        expect(request).toHaveBeenCalledTimes(1);
        expect(first.report.resolvedCount).toBe(2);
        expect(first.report.uniqueResourceCount).toBe(1);
        expect(second.report.complete).toBe(true);
        expect(cache.uniqueResourceCount).toBe(1);
    });

    it("replaces unsupported MIME responses with a visible typed placeholder", async () => {
        const { app } = makeApp();
        const request = jest.fn<ShareCardRequestUrl>(async () => imageResponse(bytes("html"), "text/html"));
        const url = "https://cdn.example.test/not-an-image.png";

        const result = await localizeShareCardResources(
            app,
            `![Wrong MIME](${url})`,
            {},
            { requestUrl: request },
        );

        expect(result.markdown).not.toContain(url);
        expect(result.markdown).toContain("data:image/svg+xml");
        expect(decodeURIComponent(result.markdown)).toContain("Image unavailable: Wrong MIME");
        expect(result.report.resources[0]).toMatchObject({
            status: "placeholder",
            failureReason: "unsupported-mime",
        });
    });

    it("rejects oversized Vault image and note stats before reading while retaining post-read checks", async () => {
        const oversizedImage = {
            path: "oversized.png",
            extension: "png",
            binary: pngBytes("actual"),
            stat: { size: 10_000 },
        };
        const oversizedNote = {
            path: "oversized.md",
            extension: "md",
            markdown: "small cached content",
            stat: { size: 10_000 },
        };
        const preflight = makeApp({
            "oversized.png": oversizedImage,
            "oversized.md": oversizedNote,
        });
        const result = await localizeShareCardResources(
            preflight.app,
            "![[oversized.png]]\n![[oversized.md]]",
            {},
            {
                limits: {
                    maxSingleResourceBytes: 100,
                    maxEmbeddedMarkdownBytes: 100,
                },
            },
        );

        expect(preflight.readBinary).not.toHaveBeenCalled();
        expect(preflight.cachedRead).not.toHaveBeenCalled();
        expect(result.report.resources.map(({ failureReason }) => failureReason)).toEqual([
            "resource-too-large",
            "embedded-content-too-large",
        ]);

        const changedAfterStat = {
            path: "changed.png",
            extension: "png",
            binary: pngBytes("larger after stat"),
            stat: { size: 1 },
        };
        const postRead = makeApp({ "changed.png": changedAfterStat });
        const changed = await localizeShareCardResources(
            postRead.app,
            "![[changed.png]]",
            {},
            { limits: { maxSingleResourceBytes: 8 } },
        );
        expect(postRead.readBinary).toHaveBeenCalledTimes(1);
        expect(changed.report.resources[0].failureReason).toBe("resource-too-large");
    });

    it("uses Vault note stat reservations to stop aggregate over-read", async () => {
        const first = { path: "first.md", extension: "md", markdown: "123456" };
        const second = { path: "second.md", extension: "md", markdown: "abcdef" };
        const { app, cachedRead } = makeApp({ "first.md": first, "second.md": second });

        const result = await localizeShareCardResources(
            app,
            "![[first.md]]\n![[second.md]]",
            {},
            { limits: { maxEmbeddedMarkdownBytes: 6 } },
        );

        expect(cachedRead).toHaveBeenCalledTimes(1);
        expect(result.report.resolvedCount).toBe(1);
        expect(result.report.resources.some(
            ({ failureReason }) => failureReason === "embedded-content-too-large",
        )).toBe(true);
    });

    it("enforces single, aggregate, count, and embedded Markdown limits", async () => {
        const files = {
            "one.png": { path: "one.png", extension: "png", binary: pngBytes() },
            "two.png": { path: "two.png", extension: "png", binary: pngBytes("2") },
            "three.png": { path: "three.png", extension: "png", binary: pngBytes("33") },
        };
        const { app, readBinary, getFiles } = makeApp(files);
        const result = await localizeShareCardResources(
            app,
            "![[one.png]]\n![[two.png]]\n![[three.png]]",
            {},
            {
                limits: {
                    maxResourceCount: 2,
                    maxSingleResourceBytes: 20,
                    maxTotalResourceBytes: pngBytes().byteLength,
                },
            },
        );

        expect(readBinary).toHaveBeenCalledTimes(1);
        expect(getFiles).not.toHaveBeenCalled();
        expect(result.report.resolvedCount).toBe(1);
        expect(result.report.placeholderCount).toBe(2);
        expect(result.report.resources.map(({ failureReason }) => failureReason)).toEqual([
            undefined,
            "resource-total-limit",
            "resource-count-limit",
        ]);

        const note = { path: "Large.md", extension: "md", markdown: "too large" };
        const noteApp = makeApp({ "Large.md": note });
        const embedded = await localizeShareCardResources(
            noteApp.app,
            "![[Large.md]]",
            {},
            { limits: { maxEmbeddedMarkdownBytes: 2 } },
        );
        expect(embedded.report.resources[0].failureReason).toBe("embedded-content-too-large");
    });

    it("counts unsupported and missing explicit references before request or Vault lookup", async () => {
        const unsupportedApp = makeApp();
        const unsupportedRequest = jest.fn<ShareCardRequestUrl>();
        const unsupported = await localizeShareCardResources(
            unsupportedApp.app,
            Array.from({ length: 33 }, (_, index) => (
                `![](custom-${index}:asset)`
            )).join("\n"),
            {},
            { requestUrl: unsupportedRequest },
        );

        expect(unsupportedRequest).not.toHaveBeenCalled();
        expect(unsupportedApp.getFirstLinkpathDest).not.toHaveBeenCalled();
        expect(unsupported.report.resources).toHaveLength(33);
        expect(unsupported.report.uniqueResourceCount).toBe(33);
        expect(unsupported.report.resources[32].failureReason).toBe("resource-count-limit");

        const missingApp = makeApp();
        const missing = await localizeShareCardResources(
            missingApp.app,
            Array.from({ length: 33 }, (_, index) => `![[missing-${index}.png]]`).join("\n"),
        );
        expect(missingApp.getFirstLinkpathDest).toHaveBeenCalledTimes(32);
        expect(missingApp.readBinary).not.toHaveBeenCalled();
        expect(missing.report.resources).toHaveLength(33);
        expect(missing.report.resources[32].failureReason).toBe("resource-count-limit");
    });

    it("bounds repeated image localization output and replaces only overflowing occurrences", async () => {
        const { app } = makeApp();
        const payload = pngBytes("x".repeat(1_024));
        const request = jest.fn<ShareCardRequestUrl>(async () => imageResponse(payload));
        const markdown = Array.from({ length: 4 }, (_, index) => (
            `![Image ${index}](https://cdn.test/shared.png)`
        )).join("\n");
        const maxLocalizedOutputBytes = 4_500;

        const result = await localizeShareCardResources(
            app,
            markdown,
            {},
            {
                requestUrl: request,
                limits: {
                    maxSingleResourceBytes: payload.byteLength,
                    maxLocalizedOutputBytes,
                },
            },
        );

        expect(request).toHaveBeenCalledTimes(1);
        expect(bytes(result.markdown).byteLength).toBeLessThanOrEqual(maxLocalizedOutputBytes);
        expect(result.report.resolvedCount).toBeGreaterThan(0);
        expect(result.report.resources.some(
            ({ failureReason }) => failureReason === "localized-output-too-large",
        )).toBe(true);
        expect(result.report.complete).toBe(false);
    });

    it("bounds repeated note and DAG expansion without rereading shared notes", async () => {
        const leaf = {
            path: "Leaf.md",
            extension: "md",
            markdown: `Leaf ${"x".repeat(1_000)}`,
        };
        const left = { path: "Left.md", extension: "md", markdown: "Left ![[Leaf.md]]" };
        const right = { path: "Right.md", extension: "md", markdown: "Right ![[Leaf.md]]" };
        const { app, cachedRead } = makeApp({
            "Leaf.md": leaf,
            "Left.md": left,
            "Right.md": right,
        });
        const maxLocalizedOutputBytes = 3_600;

        const result = await localizeShareCardResources(
            app,
            "![[Left.md]]\n![[Right.md]]\n![[Leaf.md]]",
            {},
            { limits: { maxLocalizedOutputBytes } },
        );

        expect(cachedRead).toHaveBeenCalledTimes(3);
        expect(bytes(result.markdown).byteLength).toBeLessThanOrEqual(maxLocalizedOutputBytes);
        expect(result.report.resources.some(
            ({ failureReason }) => failureReason === "localized-output-too-large",
        )).toBe(true);
        expect(result.report.complete).toBe(false);
    });

    it("turns per-resource and shared-session deadlines into typed placeholders", async () => {
        const { app } = makeApp();
        const request = jest.fn<ShareCardRequestUrl>(() => new Promise(() => undefined));
        const single = await localizeShareCardResources(
            app,
            "![Slow](https://cdn.example.test/slow.png)",
            {},
            { requestUrl: request, limits: { timeoutMs: 1 } },
        );
        expect(single.report.resources[0]).toMatchObject({
            status: "placeholder",
            failureReason: "timeout",
        });

        jest.useFakeTimers();
        try {
            const sharedRequest = jest.fn<ShareCardRequestUrl>(() => new Promise(() => undefined));
            const pending = localizeShareCardResources(
                app,
                ["one", "two", "three"].map(
                    (name) => `![${name}](https://cdn.example.test/${name}.png)`,
                ).join("\n"),
                {},
                {
                    requestUrl: sharedRequest,
                    limits: { timeoutMs: 1_000, sessionTimeoutMs: 20, maxConcurrency: 1 },
                },
            );
            expect(sharedRequest).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(25);
            const shared = await pending;
            expect(sharedRequest).toHaveBeenCalledTimes(1);
            expect(shared.report.resources).toHaveLength(3);
            expect(shared.report.resources.every(
                ({ failureReason }) => failureReason === "timeout",
            )).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    it("bounds concurrent resource requests", async () => {
        const { app } = makeApp();
        let active = 0;
        let maximumActive = 0;
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const request = jest.fn<ShareCardRequestUrl>(async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await gate;
            active -= 1;
            return imageResponse();
        });
        const pending = localizeShareCardResources(
            app,
            ["a", "b", "c", "d", "e"].map((name) => (
                `![](${`https://cdn.test/${name}.png`})`
            )).join("\n"),
            {},
            { requestUrl: request, limits: { maxConcurrency: 2 } },
        );

        expect(request).toHaveBeenCalledTimes(2);
        release();
        const result = await pending;
        expect(result.report.complete).toBe(true);
        expect(request).toHaveBeenCalledTimes(5);
        expect(maximumActive).toBe(2);
    });

    it("opens the scheduler timeout circuit without starting queued non-abortable requests", async () => {
        jest.useFakeTimers();
        try {
            const { app } = makeApp();
            const request = jest.fn<ShareCardRequestUrl>(() => new Promise(() => undefined));
            const pending = localizeShareCardResources(
                app,
                [
                    "![](https://cdn.test/first.png)",
                    "![](https://cdn.test/second.png)",
                ].join("\n"),
                {},
                {
                    requestUrl: request,
                    limits: {
                        maxConcurrency: 1,
                        timeoutMs: 20,
                        sessionTimeoutMs: 1_000,
                    },
                },
            );

            expect(request).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(21);
            const result = await pending;
            expect(request).toHaveBeenCalledTimes(1);
            expect(result.report.resources.map(({ failureReason }) => failureReason)).toEqual([
                "timeout",
                "timeout",
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    it("rejects promptly on abort and does not begin later resource requests", async () => {
        const { app } = makeApp();
        let resolveRequest: ((value: ReturnType<typeof imageResponse>) => void) | undefined;
        const request = jest.fn<ShareCardRequestUrl>(() => new Promise((resolve) => {
            resolveRequest = resolve;
        }));
        const controller = new AbortController();
        const pending = localizeShareCardResources(
            app,
            [
                "![One](https://cdn.example.test/one.png)",
                "![Two](https://cdn.example.test/two.png)",
            ].join("\n"),
            { signal: controller.signal },
            { requestUrl: request, limits: { maxConcurrency: 1 } },
        );

        expect(request).toHaveBeenCalledTimes(1);
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(ShareCardResourceAbortedError);
        expect(request).toHaveBeenCalledTimes(1);
        resolveRequest?.(imageResponse());
    });

    it("localizes reference-style Markdown images without rewriting their definitions", async () => {
        const { app } = makeApp();
        const request = jest.fn<ShareCardRequestUrl>(async () => imageResponse());
        const markdown = [
            "![Reference][hero]",
            "[hero]: https://cdn.example.test/hero.png \"Title\"",
        ].join("\n");

        const result = await localizeShareCardResources(app, markdown, {}, { requestUrl: request });

        expect(result.markdown).toMatch(/^!\[Reference\]\(data:image\/png;base64,/);
        expect(result.markdown).toContain("[hero]: https://cdn.example.test/hero.png \"Title\"");
        expect(request).toHaveBeenCalledTimes(1);
    });
});
