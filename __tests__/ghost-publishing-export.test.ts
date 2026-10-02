import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, jest } from "@jest/globals";

import {
    buildGhostPublishingFields,
    ghostFieldsForCandidate,
} from "../src/ghost-publishing/fields";
import { prepareGhostExport } from "../src/ghost-publishing/exporter";
import { planFormatPreservation } from "../src/ghost-publishing/format-preservation";
import { buildRecipeInjection } from "../src/ghost-publishing/recipe";
import { GhostExportError } from "../src/ghost-publishing/errors";
import { loadGhostSourceTree } from "../src/ghost-publishing/source-loader";
import type {
    GhostPublishingHost,
    GhostPublishingSourceFile,
    GhostPublishingSourceGuard,
    SitePublishingProfile,
} from "../src/ghost-publishing/types";

const fixtureRoot = join(__dirname, "fixtures", "ghost-publishing");
const f01 = readFileSync(join(fixtureRoot, "F-01.md"), "utf8");
const embedded = readFileSync(join(fixtureRoot, "Embedded.md"), "utf8");
const expected = JSON.parse(readFileSync(join(fixtureRoot, "expected.json"), "utf8")) as {
    exactCode: { text: string };
    mermaid: string;
};

interface FakeFile extends GhostPublishingSourceFile {
    content: string;
}

function fakeFile(path: string, content: string): FakeFile {
    const name = path.split("/").pop() ?? path;
    return {
        path,
        name,
        basename: name.replace(/\.md$/i, ""),
        extension: name.includes(".") ? name.split(".").pop() ?? "" : "",
        stat: { mtime: 10, size: content.length, ctime: 1 },
        content,
    };
}

function parseFixtureYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let inGhost = false;
    let currentGhostKey: string | null = null;
    for (const line of yaml.split(/\r?\n/)) {
        if (/^ghost:\s*$/.test(line)) {
            result.ghost = {};
            inGhost = true;
            currentGhostKey = null;
            continue;
        }
        if (inGhost && /^\s+-\s+/.test(line)) {
            if (!currentGhostKey) continue;
            const ghost = result.ghost as Record<string, unknown>;
            const list = ghost[currentGhostKey] as string[];
            list.push(line.replace(/^\s+-\s+/, "").trim());
            continue;
        }
        const match = /^(\s*)([^:]+):\s*(.*)$/.exec(line);
        if (!match) continue;
        const indent = match[1].length;
        const key = match[2].trim();
        const raw = match[3].trim();
        if (indent === 0) inGhost = key === "ghost";
        if (!inGhost || indent === 0) {
            if (raw === "null") result[key] = null;
            else if (raw === "true") result[key] = true;
            else if (raw === "false") result[key] = false;
            else if (raw !== "") result[key] = raw.replace(/^['"]|['"]$/g, "");
            currentGhostKey = null;
            continue;
        }
        const ghost = result.ghost as Record<string, unknown>;
        currentGhostKey = key;
        if (/^\s*-/.test(yaml.split(/\r?\n/).find((next) => next.trim().startsWith(`-`)) ?? "")) ghost[key] = [];
        if (raw === "null") ghost[key] = null;
        else if (raw === "true") ghost[key] = true;
        else if (raw === "false") ghost[key] = false;
        else if (raw !== "") ghost[key] = raw.replace(/^['"]|['"]$/g, "");
    }
    return result;
}

function createHost(files: FakeFile[], options: { parseYaml?: (yaml: string) => unknown } = {}): GhostPublishingHost {
    return {
        vault: {
            read: async (file) => files.find((candidate) => candidate.path === file.path)?.content ?? "",
            getAbstractFileByPath: (path) => files.find((file) => file.path === path) ?? null,
        },
        metadataCache: {
            getFirstLinkpathDest: (linkpath, sourcePath) => {
                const normalized = linkpath.replace(/\.md$/i, "");
                const sourceDirectory = sourcePath.split("/").slice(0, -1).join("/");
                const relative = sourceDirectory ? `${sourceDirectory}/${linkpath}` : linkpath;
                return files.find((file) => file.path === relative)
                    ?? files.find((file) => file.path === linkpath)
                    ?? files.find((file) => file.path.replace(/\.md$/i, "") === normalized)
                    ?? files.find((file) => file.basename === normalized)
                    ?? null;
            },
        },
        parseYaml: options.parseYaml ?? parseFixtureYaml,
    };
}

const allowAllGuard = (): GhostPublishingSourceGuard => ({
    isCurrent: () => true,
    isPathAllowed: () => true,
    captureSourceValidity: () => () => true,
});

const profile: SitePublishingProfile = {
    siteId: "synthetic-site",
    prism: { compatible: false, evidence: "unknown" },
    mermaid: { compatible: false, evidence: "unknown" },
    katex: { compatible: false, evidence: "unknown" },
};

function f01Host(): GhostPublishingHost {
    return createHost([
        fakeFile("fixtures/F-01.md", f01),
        fakeFile("fixtures/Embedded.md", embedded),
        fakeFile("fixtures/local-image.png", "binary-local"),
    ]);
}

async function exportF01() {
    return prepareGhostExport({
        targetPath: "fixtures/F-01.md",
        host: f01Host(),
        guard: allowAllGuard(),
        siteProfile: profile,
        wikiLinks: {
            "Existing published test post": { status: "published", url: "https://example.invalid/published" },
        },
    });
}

describe("Ghost publishing deterministic export", () => {
    it("collects only actual ordinary wiki tokens with exact main and embedded source locations", async () => {
        const main = fakeFile("Main.md", "[[Target|Visible]]\n\n`[[Code]]`\n\n```\n[[Fence]]\n```\n\n![[nested/Embed.md]]");
        const embedded = fakeFile("nested/Embed.md", "Embedded\n\n[[Target#Heading|Section]]");
        const resolver = jest.fn<NonNullable<Parameters<typeof prepareGhostExport>[0]["resolveWikiLinks"]>>(async () => ({ Target: { status: "published" as const, url: "https://example.invalid/article/" },
            "Target#Heading": { status: "published" as const, url: "https://example.invalid/article/", anchorFallback: true } }));
        const result = await prepareGhostExport({ targetPath: main.path, host: createHost([main, embedded]),
            guard: allowAllGuard(), siteProfile: profile, resolveWikiLinks: resolver });
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(resolver).toHaveBeenCalledWith([
            { target: "Target", sourcePath: "Main.md", line: 1 },
            { target: "Target#Heading", sourcePath: "nested/Embed.md", line: 3 },
        ]);
        expect(JSON.stringify(result.lexical)).toContain("https://example.invalid/article/");
        expect(result.warnings).toEqual([{ code: "wiki-link-anchor-fallback", path: "nested/Embed.md", line: 3,
            message: "wiki-link-anchor-fallback" }]);
    });

    it("exports the synthetic comprehensive fixture without changing sources", async () => {
        const host = f01Host();
        const result = await prepareGhostExport({
            targetPath: "fixtures/F-01.md",
            host,
            guard: allowAllGuard(),
            siteProfile: profile,
            wikiLinks: {
                "Existing published test post": { status: "published", url: "https://example.invalid/published" },
            },
        });
        const deterministicRepeat = await exportF01();
        const differentProfile = await prepareGhostExport({
            targetPath: "fixtures/F-01.md",
            host: f01Host(),
            guard: allowAllGuard(),
            siteProfile: {
                ...profile,
                prism: { compatible: true, evidence: "page-check" },
            },
            wikiLinks: {
                "Existing published test post": { status: "published", url: "https://example.invalid/published" },
            },
        });
        expect(deterministicRepeat.candidateHash).toBe(result.candidateHash);
        expect(differentProfile.candidateHash).not.toBe(result.candidateHash);
        const allNodeTypes = (nodes: Array<{ type: string; children?: unknown }>): string[] => nodes.flatMap((node) => [
            node.type,
            ...(Array.isArray(node.children) ? allNodeTypes(node.children as Array<{ type: string; children?: unknown }>) : []),
        ]);
        const types = allNodeTypes(result.lexical.root.children);
        const code = result.lexical.root.children.find((node) => node.type === "codeblock" && node.language === "javascript");
        const mermaid = result.lexical.root.children.find((node) => node.type === "codeblock" && node.language === "mermaid");
        const html = result.lexical.root.children.filter((node) => node.type === "html");
        const images = result.lexical.root.children.filter((node) => node.type === "image");

        expect(types).toEqual(expect.arrayContaining([
            "extended-heading", "paragraph", "list", "codeblock", "image", "html", "link",
        ]));
        expect(code).toMatchObject({ code: expected.exactCode.text, language: "javascript" });
        expect(mermaid).toMatchObject({ code: `${expected.mermaid}\n`, language: "mermaid" });
        expect(html.some((node) => String(node.html).includes("pa-ghost-math-block") && String(node.html).includes("\\int_{0}^{1}"))).toBe(true);
        expect(html.some((node) => String(node.html).includes("<table>") && String(node.html).includes("exact characters"))).toBe(true);
        expect(images).toHaveLength(2);
        expect(result.resources.map((resource) => resource.kind)).toEqual(["local", "remote"]);
        expect(result.resources[0]).toMatchObject({ source: "local-image.png", resolvedPath: "fixtures/local-image.png" });
        expect(result.resources[0].occurrences).toHaveLength(2);
        expect(result.fields.title).toEqual({ mode: "manage", value: "B-153 Synthetic Comprehensive Fixture" });
        expect(result.fields.tags).toEqual({ mode: "manage", value: ["B-153", "Synthetic"] });
        expect(result.fields.featureImage.value).toBe("pending-resource://resource-1");
        expect(result.fields.customExcerpt).toEqual({ mode: "manage", value: "Synthetic fixture for Ghost publishing feasibility." });
        expect(result.capabilities).toEqual({
            codeLanguages: ["javascript"],
            hasMermaid: true,
            hasInlineMath: true,
            hasDisplayMath: true,
        });
        expect(result.sourceManifest.dependencies.map((dependency) => dependency.kind)).toEqual(["main", "embed"]);
        const embeddedBlock = result.blocks.find((block) => block.sourcePath === "fixtures/Embedded.md");
        expect(embeddedBlock?.sourceDependencyIndex).toBe(1);
        expect(JSON.stringify(result.lexical.root.children.slice(
            embeddedBlock?.nodeIndex ?? 0,
            (embeddedBlock?.nodeIndex ?? 0) + 2,
        ))).toContain("This section is explicitly embedded by F-01.");
        expect(JSON.stringify(result)).not.toContain("synthetic-not-for-export");
        expect(await host.vault.read({ path: "fixtures/F-01.md", extension: "md" })).toBe(f01);
        expect(await host.vault.read({ path: "fixtures/Embedded.md", extension: "md" })).toBe(embedded);
    });

    it("fails closed for missing, cyclic, excluded, or changing source guards", async () => {
        await expect(prepareGhostExport({
            targetPath: "Missing.md",
            host: createHost([]),
            guard: allowAllGuard(),
            siteProfile: profile,
        })).rejects.toMatchObject({ code: "source-not-found" });

        const cycleHost = createHost([
            fakeFile("A.md", "![[B#Part]]"),
            fakeFile("B.md", "# Part\n\n![[A#Part]]"),
        ]);
        await expect(prepareGhostExport({
            targetPath: "A.md",
            host: cycleHost,
            guard: allowAllGuard(),
            siteProfile: profile,
        })).rejects.toMatchObject({ code: "embed-cycle" });

        const missingEmbedHost = createHost([fakeFile("A.md", "![[Missing.md]]")]);
        await expect(prepareGhostExport({
            targetPath: "A.md",
            host: missingEmbedHost,
            guard: allowAllGuard(),
            siteProfile: profile,
        })).rejects.toMatchObject({ code: "embed-not-found" });

        const main = fakeFile("Main.md", "![[Embedded.md]]");
        const dependency = fakeFile("Embedded.md", "Embedded body");
        const read = jest.fn(async (file: GhostPublishingSourceFile) => file.path === "Main.md" ? main.content : dependency.content);
        const guard: GhostPublishingSourceGuard = {
            isCurrent: () => true,
            isPathAllowed: (path) => path === "Main.md",
            captureSourceValidity: () => () => true,
        };
        await expect(prepareGhostExport({
            targetPath: "Main.md",
            host: {
                vault: { read, getAbstractFileByPath: (path) => path === main.path ? main : path === dependency.path ? dependency : null },
                metadataCache: { getFirstLinkpathDest: (linkpath) => linkpath === "Embedded.md" ? dependency : null },
                parseYaml: () => ({}),
            },
            guard,
            siteProfile: profile,
        })).rejects.toMatchObject({ code: "guard-revoked" });
        expect(read).toHaveBeenCalledTimes(1);
    });

    it("accepts the real source receipt contract and detects await-time revocation", async () => {
        const realShapeGuard: GhostPublishingSourceGuard = {
            isCurrent: () => true,
            isPathAllowed: () => true,
            captureSourceValidity: () => () => true,
        };
        await expect(loadGhostSourceTree(
            "A.md",
            createHost([fakeFile("A.md", "Hello")]),
            realShapeGuard,
        )).resolves.toMatchObject({ markdown: "Hello" });

        let releaseRead!: (value: string) => void;
        const current = { value: true };
        const read = jest.fn(() => new Promise<string>((resolve) => {
            releaseRead = resolve;
        }));
        const guard: GhostPublishingSourceGuard = {
            isCurrent: () => current.value,
            isPathAllowed: () => true,
            captureSourceValidity: () => () => current.value,
        };
        const pending = loadGhostSourceTree("A.md", {
            vault: {
                read,
                getAbstractFileByPath: (path) => path === "A.md" ? fakeFile("A.md", "") : null,
            },
            parseYaml: () => ({}),
        }, guard);
        await new Promise<void>((resolve) => {
            const poll = setInterval(() => {
                if (read.mock.calls.length > 0) {
                    clearInterval(poll);
                    resolve();
                }
            }, 1);
        });
        current.value = false;
        releaseRead("Hello");
        await expect(pending).rejects.toMatchObject({ code: "guard-revoked" });
    });

    it("detects a main-note identity change while an embedded note is being read", async () => {
        const main = fakeFile("Main.md", "![[Dependency.md]]");
        const dependency = fakeFile("Dependency.md", "Dependency body");
        const read = jest.fn(async (file: GhostPublishingSourceFile) => {
            if (file.path === dependency.path) main.stat = { ...main.stat, mtime: 99, size: 99 };
            return file.path === main.path ? main.content : dependency.content;
        });
        await expect(prepareGhostExport({
            targetPath: "Main.md",
            host: {
                vault: {
                    read,
                    getAbstractFileByPath: (path) => path === main.path ? main : path === dependency.path ? dependency : null,
                },
                metadataCache: {
                    getFirstLinkpathDest: (linkpath) => linkpath === "Dependency.md" ? dependency : null,
                },
                parseYaml: () => ({}),
            },
            guard: allowAllGuard(),
            siteProfile: profile,
        })).rejects.toMatchObject({ code: "source-changed" });
        expect(read).toHaveBeenCalledTimes(2);
    });

    it("keeps repeated embeds, literal code examples, and true cycles distinct", async () => {
        const repeated = await loadGhostSourceTree(
            "A.md",
            createHost([fakeFile("A.md", "![[B.md]]\n\n![[B.md]]"), fakeFile("B.md", "Hello")]),
            allowAllGuard(),
        );
        expect(repeated.markdown).toBe("Hello\n\nHello");
        expect(repeated.dependencies).toHaveLength(2);

        const literal = await loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "Intro\n\n```text\n![[Missing.md]]\n```\n\nInline `![[Missing.md]]` stays text"),
        ]), allowAllGuard());
        expect(literal.markdown).toContain("```text\n![[Missing.md]]\n```");
        expect(literal.markdown).toContain("Inline `![[Missing.md]]` stays text");

        const multiline = await loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "Intro\n![[B.md]]"),
            fakeFile("B.md", "Hello"),
        ]), allowAllGuard());
        expect(multiline.markdown).toBe("Intro\nHello");

        const escaped = await loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "\\![[B.md]]"),
            fakeFile("B.md", "Hello"),
        ]), allowAllGuard());
        expect(escaped.markdown).toBe("\\![[B.md]]");
        expect(escaped.dependencies).toHaveLength(1);

        const escapedPlusReal = await loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "\\![[Missing.md]] and ![[B.md]]"),
            fakeFile("B.md", "Hello"),
        ]), allowAllGuard());
        expect(escapedPlusReal.markdown).toBe("\\![[Missing.md]] and Hello");
        expect(escapedPlusReal.dependencies.map((dependency) => dependency.path)).toEqual(["A.md", "B.md"]);

        const styled = await loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "Hello **there** ![[B.md]]"),
            fakeFile("B.md", "Embedded body"),
        ]), allowAllGuard());
        expect(styled.markdown).toBe("Hello **there** Embedded body");
        expect(styled.dependencies.map((dependency) => dependency.path)).toEqual(["A.md", "B.md"]);

        const blockquote = await loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "> Intro\n> ![[B.md]]"),
            fakeFile("B.md", "Hello"),
        ]), allowAllGuard());
        expect(blockquote.markdown).toBe("> Intro\n> Hello");
        expect(blockquote.dependencies.map((dependency) => dependency.path)).toEqual(["A.md", "B.md"]);

        const list = await loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "- Intro\n  ![[B.md]]"),
            fakeFile("B.md", "Hello"),
        ]), allowAllGuard());
        expect(list.markdown).toBe("- Intro\n  Hello");
        expect(list.dependencies.map((dependency) => dependency.path)).toEqual(["A.md", "B.md"]);

        await expect(loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "![[B.md]]"),
            fakeFile("B.md", "![[A.md]]"),
        ]), allowAllGuard())).rejects.toMatchObject({ code: "embed-cycle" });
    });

    it("expands table note embeds and preserves inline wiki images", async () => {
        const host = createHost([
            fakeFile("A.md", "| Item | Content |\n|---|---|\n| Note | ![[sub/B.md]] |"),
            fakeFile("sub/B.md", "Embedded body ![[cover.png]]"),
            fakeFile("sub/cover.png", "correct binary"),
            fakeFile("cover.png", "wrong root binary"),
        ]);
        const loaded = await loadGhostSourceTree("A.md", host, allowAllGuard());
        expect(loaded.dependencies.map((dependency) => dependency.path)).toEqual(["A.md", "sub/B.md"]);
        expect(loaded.markdown).toContain("Embedded body ![[cover.png]]");
        const result = await prepareGhostExport({ targetPath: "A.md", host, guard: allowAllGuard(), siteProfile: profile });
        const table = result.lexical.root.children[0];
        expect(table).toMatchObject({ type: "html" });
        expect(table.html).toContain("Embedded body <img");
        expect(result.resources).toHaveLength(1);
        expect(result.resources[0]).toMatchObject({ source: "cover.png", resolvedPath: "sub/cover.png" });
        expect(result.resources[0].occurrences).toEqual([{ path: "sub/B.md", line: 0 }]);

        const inline = await prepareGhostExport({
            targetPath: "A.md",
            host: createHost([fakeFile("A.md", "Before ![[cover.png]] after."), fakeFile("cover.png", "binary")]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(inline.lexical.root.children.map((node) => node.type)).toEqual(["paragraph", "image", "paragraph"]);
        expect(inline.lexical.root.children[0].children).toEqual([expect.objectContaining({ text: "Before " })]);
        expect(inline.lexical.root.children[2].children).toEqual([expect.objectContaining({ text: " after." })]);
        expect(inline.resources).toHaveLength(1);

        await expect(loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "| A | B |\n|---|---|\n| Note | ![[Missing.md]] |"),
        ]), allowAllGuard())).rejects.toBeInstanceOf(GhostExportError);
    });

    it("maps repeated table images by cell position, including escaped pipe content", async () => {
        const result = await prepareGhostExport({
            targetPath: "A.md",
            host: createHost([
                fakeFile("A.md", "| Left | Right |\n|---|---|\n| ![a\\|b](cover.png) | ![a\\|b](cover.png) |"),
                fakeFile("cover.png", "binary"),
            ]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(result.resources).toHaveLength(1);
        expect(result.resources[0].occurrences).toEqual([{ path: "A.md", line: 2 }, { path: "A.md", line: 2 }]);
        expect(result.lexical.root.children[0].html).toBe(
            '<table><thead><tr><th>Left</th><th>Right</th></tr></thead><tbody><tr><td><img src="pending-resource://resource-1" alt="a|b"></td><td><img src="pending-resource://resource-1" alt="a|b"></td></tr></tbody></table>',
        );
    });

    it("uses the read snapshot and selection boundary for heading and nested embeds", async () => {
        const host = createHost([
            fakeFile("A.md", "![[B.md#Target]]"),
            fakeFile("B.md", "---\nx: y\n---\n# Target\nWanted body\n# Other\n![[Missing.md]]"),
        ], {
            parseYaml: () => ({ x: "y" }),
        });
        (host.resolveSubpath as NonNullable<GhostPublishingHost["resolveSubpath"]>) = () => ({
            type: "heading",
            start: { line: 3, col: 0 },
            end: { line: 5, col: 0 },
        });
        const result = await loadGhostSourceTree("A.md", host, allowAllGuard());
        expect(result.markdown).toBe("# Target\nWanted body");
        expect(result.dependencies.map((dependency) => dependency.path)).toEqual(["A.md", "B.md"]);

        const nested = await loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "![[sub/B.md]]"),
            fakeFile("sub/B.md", "![[C.md]]"),
            fakeFile("sub/C.md", "Deep body"),
        ]), allowAllGuard());
        expect(nested.markdown).toBe("Deep body");

        const staleEndHost = createHost([
            fakeFile("A.md", "![[B.md#Target]]"),
            fakeFile("B.md", "# Target\nWanted one\nAdded two\n# Other\nNot selected"),
        ]);
        (staleEndHost.resolveSubpath as NonNullable<GhostPublishingHost["resolveSubpath"]>) = () => ({
            type: "heading",
            start: { line: 0, col: 0 },
            end: { line: 2, col: 0 },
        });
        const staleEnd = await loadGhostSourceTree("A.md", staleEndHost, allowAllGuard());
        expect(staleEnd.markdown).toBe("# Target\nWanted one\nAdded two");

        const multilineBlockHost = createHost([
            fakeFile("A.md", "![[B.md#^part]]"),
            fakeFile("B.md", "First line\nSecond line ^part"),
        ]);
        (multilineBlockHost.resolveSubpath as NonNullable<GhostPublishingHost["resolveSubpath"]>) = () => ({
            type: "block",
            start: { line: 0, col: 0 },
            end: { line: 1, col: 17 },
        });
        const multilineBlock = await loadGhostSourceTree("A.md", multilineBlockHost, allowAllGuard());
        expect(multilineBlock.markdown).toBe("First line\nSecond line");

        const fencedHeadingHost = createHost([
            fakeFile("A.md", "![[B.md#Target]]"),
            fakeFile("B.md", "# Target\n```python\n# comment\nprint(1)\n```\nTail\n# Other\nExcluded"),
        ]);
        const fencedHeading = await loadGhostSourceTree("A.md", fencedHeadingHost, allowAllGuard());
        expect(fencedHeading.markdown).toBe("# Target\n```python\n# comment\nprint(1)\n```\nTail");
        expect(fencedHeading.dependencies).toHaveLength(2);

        const parentChildHeading = await loadGhostSourceTree("A.md", createHost([
            fakeFile("A.md", "![[B.md#Target]]"),
            fakeFile("B.md", "# Target\nIntro\n## Child\nChild body"),
        ]), allowAllGuard());
        expect(parentChildHeading.markdown).toBe("# Target\nIntro\n## Child\nChild body");
    });

    it("keeps field three-states explicit", () => {
        const unmanaged = buildGhostPublishingFields({ ghost: {} }, "Note.md");
        expect(ghostFieldsForCandidate(unmanaged)).toEqual({ title: "Note" });

        const cleared = buildGhostPublishingFields({
            ghost: { tags: null, feature_image: "", custom_excerpt: null, meta_description: "" },
        }, "Note.md");
        expect(ghostFieldsForCandidate(cleared)).toEqual({
            title: "Note",
            tags: null,
            feature_image: null,
            custom_excerpt: null,
            meta_description: null,
        });

        const managed = buildGhostPublishingFields({
            ghost: { tags: ["Z", "A"], feature_image: "cover.png", custom_excerpt: "Exact", meta_description: "SEO exact" },
        }, "Note.md");
        expect(ghostFieldsForCandidate(managed)).toEqual({
            title: "Note",
            tags: ["Z", "A"],
            feature_image: "cover.png",
            custom_excerpt: "Exact",
            meta_description: "SEO exact",
        });

        const ordinary = buildGhostPublishingFields({
            excerpt: "Ordinary excerpt",
            feature_image: "",
        }, "Note.md");
        expect(ordinary.customExcerpt).toEqual({ mode: "manage", value: "Ordinary excerpt" });
        expect(ordinary.featureImage).toEqual({ mode: "unmanaged" });
        expect(ordinary.metaDescription).toEqual({ mode: "unmanaged" });

        const exact = "x".repeat(300);
        expect(buildGhostPublishingFields({ excerpt: exact }, "Note.md").customExcerpt)
            .toEqual({ mode: "manage", value: exact });
        expect(() => buildGhostPublishingFields({ excerpt: "x".repeat(301) }, "Note.md"))
            .toThrow(GhostExportError);

        expect(buildGhostPublishingFields({
            ghost: { custom_excerpt: "x".repeat(300), meta_description: "y".repeat(500) },
        }, "Note.md").metaDescription).toEqual({ mode: "manage", value: "y".repeat(500) });
        expect(() => buildGhostPublishingFields({
            ghost: { custom_excerpt: "x".repeat(301), meta_description: "y".repeat(500) },
        }, "Note.md")).toThrow(GhostExportError);
        expect(() => buildGhostPublishingFields({
            ghost: { custom_excerpt: "x".repeat(300), meta_description: "y".repeat(501) },
        }, "Note.md")).toThrow(GhostExportError);

        expect(buildGhostPublishingFields({ ghost_slug: "stable-url" }, "Note.md").slug)
            .toEqual({ mode: "manage", value: "stable-url" });
        expect(buildGhostPublishingFields({ ghost: { slug: "legacy-url" } }, "Note.md").slug)
            .toEqual({ mode: "manage", value: "legacy-url" });
        expect(buildGhostPublishingFields({ ghost_slug: "same", ghost: { slug: "same" } }, "Note.md").slug)
            .toEqual({ mode: "manage", value: "same" });
        expect(() => buildGhostPublishingFields({ ghost_slug: "one", ghost: { slug: "two" } }, "Note.md"))
            .toThrow(GhostExportError);
        for (const value of ["", null, "/post", "https://ghost.example/post", "UPPER", "double--dash", "trailing-", "a".repeat(81)]) {
            expect(() => buildGhostPublishingFields({ ghost_slug: value }, "Note.md")).toThrow(GhostExportError);
        }
    });

    it("cleans comments, the matching main H1, and the admitted PA cover block before export", async () => {
        const main = [
            "---",
            "ghost:",
            "  title: Synthetic article",
            "feature_image: \"\"",
            "excerpt: \"\"",
            "---",
            ">[!personal-assistant]- Featured Images",
            "> ![[images/cover.png|480]]",
            "%%",
            "![[Hidden.md]] ![hidden](hidden.png)",
            "%%",
            "",
            "Visible `inline %% stays` text.",
            "",
            "# Synthetic article",
            "",
            "Ordinary paragraph.",
            "",
            "```text",
            "fenced %% stays",
            "```",
            "",
            "    indented %% stays",
            "",
            "# Distinct later H1",
            "",
            "![[Embedded note]]",
            "",
            "# Synthetic article",
            "",
            "Final paragraph.",
        ].join("\n");
        const embedded = [
            "%% ![[Hidden-embed.md]] %%",
            "# Synthetic article",
            "",
            "Embedded visible paragraph.",
        ].join("\n");
        const files = [
            fakeFile("Main.md", main),
            fakeFile("Embedded note.md", embedded),
            fakeFile("images/cover.png", "cover-bytes"),
        ];
        const host = createHost(files);
        const result = await prepareGhostExport({ targetPath: "Main.md", host, guard: allowAllGuard(), siteProfile: profile });
        const serialized = JSON.stringify(result.lexical);

        expect(serialized).not.toContain("personal-assistant");
        expect(serialized).not.toContain("Featured Images");
        expect(serialized).not.toContain("Hidden.md");
        expect(serialized).not.toContain("hidden.png");
        expect(serialized).toContain("inline %% stays");
        expect(serialized).toContain("fenced %% stays");
        expect(serialized).toContain("indented %% stays");
        expect(serialized.match(/Synthetic article/g)).toHaveLength(3);
        expect(serialized).toContain("Distinct later H1");
        expect(serialized).toContain("Embedded visible paragraph.");
        expect(result.fields.featureImage).toMatchObject({ mode: "manage", value: "pending-resource://resource-1" });
        expect(result.resources).toHaveLength(1);
        expect(result.resources[0]).toMatchObject({ source: "images/cover.png", resolvedPath: "images/cover.png" });
        expect(result.resources[0].occurrences).toEqual([{ path: "Main.md", line: 6, field: "feature_image" }]);
        expect(result.sourceManifest.dependencies.map((dependency) => dependency.path)).toEqual(["Main.md", "Embedded note.md"]);
        const rawDependencyHash = async (value: string) => Array.from(
            new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
            byte => byte.toString(16).padStart(2, "0"),
        ).join("");
        expect(result.sourceManifest.dependencies.map((dependency) => dependency.contentHash)).toEqual([
            await rawDependencyHash(main.slice(main.indexOf("---\n", 4) + 4)),
            await rawDependencyHash(embedded),
        ]);
        expect(files.map((file) => file.content)).toEqual([main, embedded, "cover-bytes"]);
    });

    it("rejects an unclosed comment before hidden references are read or exported", async () => {
        const host = createHost([
            fakeFile("Main.md", "%% ![[Hidden.md]]\n\nVisible"),
            fakeFile("Hidden.md", "HIDDEN SECRET BODY"),
        ]);
        const read = jest.spyOn(host.vault, "read");
        await expect(prepareGhostExport({ targetPath: "Main.md", host, guard: allowAllGuard(), siteProfile: profile }))
            .rejects.toMatchObject({ code: "comment-unclosed" });
        expect(read.mock.calls.map(([file]) => file.path)).toEqual(["Main.md"]);
    });

    it("protects each actual inline-code range even when its text repeats a hidden comment", async () => {
        const hidden = "%% ![[Hidden.md]] %%";
        const prefix = Array.from({ length: 24 }, (_, index) => `Paragraph ${index}\r\n`).join("") + "\r\n";
        const main = [
            prefix + hidden + " and `" + hidden + "`.",
            "",
            "Repeated `duplicate` and `duplicate` code.",
            "",
            "Normalized `first",
            "second` code.",
        ].join("\r\n");
        const files = [
            fakeFile("Main.md", main),
            fakeFile("Hidden.md", "---\n---\nHIDDEN SECRET BODY"),
        ];
        const base = createHost(files);
        const read = jest.fn(base.vault.read);
        const host: GhostPublishingHost = { ...base, vault: { ...base.vault, read } };

        const result = await prepareGhostExport({ targetPath: "Main.md", host, guard: allowAllGuard(), siteProfile: profile });

        expect(read.mock.calls.map(([file]) => file.path)).toEqual(["Main.md"]);
        expect(result.sourceManifest.dependencies).toHaveLength(1);
        expect(JSON.stringify(result.lexical)).toContain(hidden);
        expect(JSON.stringify(result.lexical)).toContain("duplicate");
        expect(JSON.stringify(result.lexical)).toContain("first second");
        expect(JSON.stringify(result.lexical)).not.toContain("HIDDEN SECRET BODY");
        expect(files.map((file) => file.content)).toEqual([main, "---\n---\nHIDDEN SECRET BODY"]);
    });

    it("does not mistake legal inline code after blank CRLF lines for an unclosed comment", async () => {
        const result = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile("Main.md", "Intro\r\n\r\n\r\n\r\n`%% secret %%`\r\n\r\nVisible")]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(JSON.stringify(result.lexical)).toContain("%% secret %%");
        expect(JSON.stringify(result.lexical)).toContain("Visible");
    });

    it("maps bare-CR lines for comments, covers, and source identities", async () => {
        const result = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([
                fakeFile("Main.md", "Intro\r\r`%% secret %%`\r\r>[!personal-assistant]+ Featured Images\r> ![[cover.png]]"),
                fakeFile("cover.png", "cover"),
            ]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(JSON.stringify(result.lexical)).toContain("%% secret %%");
        expect(JSON.stringify(result.lexical)).not.toContain("Featured Images");
        expect(result.resources).toHaveLength(1);
        expect(result.resources[0]).toMatchObject({ source: "cover.png", resolvedPath: "cover.png" });
        expect(result.resources[0].occurrences).toEqual([{ path: "Main.md", line: 4, field: "feature_image" }]);
    });

    it("removes comments without turning following visible syntax into indented code", async () => {
        const image = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile("Main.md", "%% internal %% ![visible](cover.png)"), fakeFile("cover.png", "cover")]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(image.lexical.root.children).toHaveLength(1);
        expect(image.lexical.root.children[0]).toMatchObject({ type: "image" });
        expect(image.resources).toHaveLength(1);
        expect(image.resources[0]).toMatchObject({ source: "cover.png" });

        const embed = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([
                fakeFile("Main.md", "%% internal %% ![[Visible.md]]"),
                fakeFile("Visible.md", "Visible embedded body"),
            ]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(JSON.stringify(embed.lexical)).toContain("Visible embedded body");
        expect(embed.sourceManifest.dependencies.map((dependency) => dependency.path)).toEqual(["Main.md", "Visible.md"]);
    });

    it("allows code-like text inside a closed comment while protecting real code outside it", async () => {
        const result = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile(
                "Main.md",
                "`%% inline code %%`\n\n```text\nfenced %% code %%\n```\n\n%% secret\n```text\nsecret %%\n\nVisible",
            )]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        const serialized = JSON.stringify(result.lexical);
        expect(serialized).toContain("inline code");
        expect(serialized).toContain("fenced %% code %%");
        expect(serialized).toContain("Visible");
        expect(serialized).not.toContain("secret");

        await expect(prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile("Main.md", "`code`\n\n%% genuinely unclosed")]),
            guard: allowAllGuard(), siteProfile: profile,
        })).rejects.toMatchObject({ code: "comment-unclosed" });
    });

    it("ignores fence syntax inside comments without protecting later real comments", async () => {
        const main = "%%\n```\n%%\n%% ![[Hidden.md]] %%";
        const files = [fakeFile("Main.md", main), fakeFile("Hidden.md", "HIDDEN SECRET BODY")];
        const base = createHost(files);
        const read = jest.fn(base.vault.read);
        const host: GhostPublishingHost = { ...base, vault: { ...base.vault, read } };

        const result = await prepareGhostExport({ targetPath: "Main.md", host, guard: allowAllGuard(), siteProfile: profile });

        expect(read.mock.calls.map(([file]) => file.path)).toEqual(["Main.md"]);
        expect(result.sourceManifest.dependencies).toHaveLength(1);
        expect(JSON.stringify(result.lexical)).not.toContain("Hidden.md");
        expect(JSON.stringify(result.lexical)).not.toContain("HIDDEN SECRET BODY");
    });

    it("maps bare-CR fenced code and later comments without reading hidden notes", async () => {
        const main = "Intro\r\r```text\rliteral %% stays\r```\r\r%% ![[Hidden.md]] %%\rVisible";
        const files = [fakeFile("Main.md", main), fakeFile("Hidden.md", "HIDDEN SECRET BODY")];
        const base = createHost(files);
        const read = jest.fn(base.vault.read);
        const host: GhostPublishingHost = { ...base, vault: { ...base.vault, read } };

        const result = await prepareGhostExport({ targetPath: "Main.md", host, guard: allowAllGuard(), siteProfile: profile });

        expect(read.mock.calls.map(([file]) => file.path)).toEqual(["Main.md"]);
        expect(result.sourceManifest.dependencies).toHaveLength(1);
        expect(JSON.stringify(result.lexical)).toContain("literal %% stays");
        expect(JSON.stringify(result.lexical)).toContain("Visible");
        expect(JSON.stringify(result.lexical)).not.toContain("Hidden.md");
        expect(JSON.stringify(result.lexical)).not.toContain("HIDDEN SECRET BODY");
    });

    it("uses Markdown-it code boundaries for unmatched backtick syntax", async () => {
        const prepareWithHidden = async (main: string) => {
            const files = [fakeFile("Main.md", main), fakeFile("Hidden.md", "HIDDEN SECRET BODY")];
            const base = createHost(files);
            const read = jest.fn(base.vault.read);
            const host: GhostPublishingHost = { ...base, vault: { ...base.vault, read } };
            const result = await prepareGhostExport({ targetPath: "Main.md", host, guard: allowAllGuard(), siteProfile: profile });
            return { result, reads: read.mock.calls.map(([file]) => file.path) };
        };

        const backticks = await prepareWithHidden("`` %% ![[Hidden.md]] %% ```");
        expect(backticks.reads).toEqual(["Main.md"]);
        expect(backticks.result.sourceManifest.dependencies).toHaveLength(1);
        expect(JSON.stringify(backticks.result.lexical)).toContain("``  ```");
        expect(JSON.stringify(backticks.result.lexical)).not.toContain("Hidden.md");
        expect(JSON.stringify(backticks.result.lexical)).not.toContain("HIDDEN SECRET BODY");
    });

    it("uses Markdown-it code boundaries for non-closing tilde fence content", async () => {
        const files = [fakeFile("Main.md", "~~~\n~~~ x\n~~~\n%% ![[Hidden.md]] %%"), fakeFile("Hidden.md", "HIDDEN SECRET BODY")];
        const base = createHost(files);
        const read = jest.fn(base.vault.read);
        const host: GhostPublishingHost = { ...base, vault: { ...base.vault, read } };
        const result = await prepareGhostExport({ targetPath: "Main.md", host, guard: allowAllGuard(), siteProfile: profile });
        expect(read.mock.calls.map(([file]) => file.path)).toEqual(["Main.md"]);
        expect(result.sourceManifest.dependencies).toHaveLength(1);
        expect(JSON.stringify(result.lexical)).toContain("~~~ x");
        expect(JSON.stringify(result.lexical)).not.toContain("Hidden.md");
        expect(JSON.stringify(result.lexical)).not.toContain("HIDDEN SECRET BODY");
    });

    it("preserves Markdown-it fenced code inside quotes and lists", async () => {
        const result = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile(
                "Main.md",
                "> ~~~text\n> %% literal %%\n> ~~~\n\n- Item\n  ~~~js\n  code %% stays\n  ~~~",
            )]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        const serialized = JSON.stringify(result.lexical);
        expect(serialized).toContain("%% literal %%");
        expect(serialized).toContain("code %% stays");
    });

    it("removes only a matching H1 that is the first visible main root block", async () => {
        const exportTitle = async (body: string) => {
            const result = await prepareGhostExport({
                targetPath: "Main.md",
                host: createHost([fakeFile("Main.md", `---\nghost:\n  title: Main\n---\n${body}`)]),
                guard: allowAllGuard(), siteProfile: profile,
            });
            return JSON.stringify(result.lexical);
        };

        const laterHeading = await exportTitle("Intro paragraph.\n\n# Main\n\nLater");
        expect(laterHeading).toContain("Intro paragraph.");
        expect(laterHeading).toContain("Main");
        const quotedHeading = await exportTitle("> # Main\n\nOrdinary quote");
        expect(quotedHeading).toContain("Main");
        expect(quotedHeading).toContain("Ordinary quote");
        expect(await exportTitle("%% hidden %%\n# Main\n\nAfter")).not.toContain("Main");
    });

    it("preserves physical CRLF offsets while removing the management block and repeated H1", async () => {
        const main = [
            "---",
            "ghost:",
            "  title: Main",
            "---",
            ">[!personal-assistant]+ Featured Images",
            "> ![[cover.png]]",
            "",
            "# Main",
            "",
            "![ordinary](ordinary.png)",
        ].join("\r\n");
        const result = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile("Main.md", main), fakeFile("cover.png", "cover"), fakeFile("ordinary.png", "ordinary")]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        const serialized = JSON.stringify(result.lexical);
        expect(serialized).not.toContain("Featured Images");
        expect(serialized).not.toContain("Main");
        expect(serialized).toContain("\"alt\":\"ordinary\"");
        expect(result.resources.map((resource) => resource.source)).toEqual(["cover.png", "ordinary.png"]);
        expect(result.resources[0].occurrences).toEqual([{ path: "Main.md", line: 4, field: "feature_image" }]);
    });

    it("does not treat an embedded PA callout inside an ordinary main quote as main cover management", async () => {
        const result = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([
                fakeFile("Main.md", "> Intro\n> ![[Embed.md]]"),
                fakeFile("Embed.md", ">[!personal-assistant]+ Featured Images\n> ![[embed-cover.png]]\n\nEmbedded body"),
                fakeFile("embed-cover.png", "embedded"),
            ]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        const serialized = JSON.stringify(result.lexical);
        expect(serialized).toContain("Intro");
        expect(serialized).toContain("Embedded body");
        expect(result.fields.featureImage).toEqual({ mode: "unmanaged" });
        expect(result.resources).toHaveLength(1);
        expect(result.resources[0]).toMatchObject({ source: "embed-cover.png", resolvedPath: "embed-cover.png" });
        expect(result.resources[0].occurrences).toEqual([{ path: "Embed.md", line: 1 }]);
    });

    it("rejects multiple main management cover candidates before resolving either image", async () => {
        const main = [
            ">[!personal-assistant]+ Featured Images",
            "> ![[one.png]]",
            "",
            ">[!personal-assistant]- 题图",
            "> ![[two.png]]",
            "",
            "# Main",
        ].join("\n");
        const base = createHost([fakeFile("Main.md", main), fakeFile("one.png", "one"), fakeFile("two.png", "two")]);
        const resolved = jest.fn(base.metadataCache?.getFirstLinkpathDest);
        const host: GhostPublishingHost = {
            ...base,
            metadataCache: base.metadataCache ? { ...base.metadataCache, getFirstLinkpathDest: resolved } : undefined,
        };
        await expect(prepareGhostExport({ targetPath: "Main.md", host, guard: allowAllGuard(), siteProfile: profile }))
            .rejects.toMatchObject({ code: "cover-ambiguous" });
        expect(resolved).not.toHaveBeenCalled();
    });

    it("keeps feature-image provenance on the main source when the article starts with an embed", async () => {
        const files = [
            fakeFile("Main.md", "![[nested/Intro.md]]\n\n>[!personal-assistant]+ Featured Images\n> ![[cover.png]]"),
            fakeFile("nested/Intro.md", "Intro body"),
            fakeFile("nested/cover.png", "nested cover"),
            fakeFile("cover.png", "main cover"),
        ];
        const host = createHost(files);
        const inferred = await prepareGhostExport({ targetPath: "Main.md", host, guard: allowAllGuard(), siteProfile: profile });
        expect(inferred.fields.featureImage).toMatchObject({ mode: "manage", value: "pending-resource://resource-1" });
        expect(inferred.resources).toHaveLength(1);
        expect(inferred.resources[0]).toMatchObject({ source: "cover.png", resolvedPath: "cover.png" });
        expect(inferred.resources[0].occurrences).toEqual([{ path: "Main.md", line: 2, field: "feature_image" }]);

        const explicit = await prepareGhostExport({
            targetPath: "Explicit.md",
            host: createHost([
                fakeFile("Explicit.md", "---\nghost:\n  feature_image: explicit-cover.png\n---\n![[nested/Intro.md]]"),
                fakeFile("nested/Intro.md", "Intro body"),
                fakeFile("nested/explicit-cover.png", "wrong"),
                fakeFile("explicit-cover.png", "right"),
            ]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(explicit.resources).toHaveLength(1);
        expect(explicit.resources[0]).toMatchObject({ source: "explicit-cover.png", resolvedPath: "explicit-cover.png" });
        expect(explicit.resources[0].occurrences).toEqual([{ path: "Explicit.md", line: 0, field: "feature_image" }]);
    });

    it("keeps main cover provenance after a long CRLF embedded introduction", async () => {
        const nestedIntro = Array.from({ length: 100 }, (_, index) => `Nested ${index}`).join("\r\n");
        const result = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([
                fakeFile("Main.md", "![[nested/Intro.md]]\r\n\r\n> [!personal-assistant]- Featured Images\r\n> ![[cover.png]]\r\n\r\nBody"),
                fakeFile("nested/Intro.md", nestedIntro),
                fakeFile("nested/cover.png", "wrong nested cover"),
                fakeFile("cover.png", "right root cover"),
            ]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(result.fields.featureImage).toMatchObject({ mode: "manage", value: "pending-resource://resource-1" });
        expect(result.resources).toHaveLength(1);
        expect(result.resources[0]).toMatchObject({ source: "cover.png", resolvedPath: "cover.png" });
        expect(result.resources[0].occurrences).toEqual([{ path: "Main.md", line: 2, field: "feature_image" }]);
        expect(JSON.stringify(result.lexical)).not.toContain("Featured Images");
        expect(JSON.stringify(result.lexical)).toContain("Nested 99");
        expect(JSON.stringify(result.lexical)).toContain("Body");
    });

    it("keeps distinct raw hashes for equal-length hidden-comment dependency variants", async () => {
        const rawDependencyHash = async (hidden: string) => {
            const loaded = await loadGhostSourceTree("Main.md", createHost([
                fakeFile("Main.md", "![[Embed.md]]"),
                fakeFile("Embed.md", `${hidden} Visible body`),
            ]), allowAllGuard());
            return loaded.dependencies[1]?.contentHash;
        };
        const first = await rawDependencyHash("%% alpha %%");
        const second = await rawDependencyHash("%% betas %%");
        expect(first).not.toBe(second);
        expect(first).toMatch(/^[a-f0-9]{64}$/);
        expect(second).toMatch(/^[a-f0-9]{64}$/);
    });

    it("uses explicit cover priority and rejects an ambiguous PA cover block", async () => {
        const body = (cover: string) => [
            `>[!personal-assistant]+ ${cover}`,
            "> ![[images/cover.png|480]]",
            "",
            "# Managed title",
        ].join("\n");
        const explicit = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile("Main.md", `---\nghost:\n  feature_image: explicit.png\n---\n${body("题图")}`), fakeFile("explicit.png", "explicit")]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(explicit.fields.featureImage).toMatchObject({ mode: "manage", value: "pending-resource://resource-1" });
        expect(explicit.resources[0]).toMatchObject({ source: "explicit.png" });

        const cleared = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile("Main.md", `---\nghost:\n  feature_image: null\n---\n${body("Featured Images")}`), fakeFile("images/cover.png", "cover")]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(cleared.fields.featureImage).toEqual({ mode: "clear" });
        expect(cleared.resources).toEqual([]);

        const ordinary = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile("Main.md", `---\nfeature_image: ordinary.png\n---\n${body("Featured Images")}`), fakeFile("ordinary.png", "ordinary")]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(ordinary.fields.featureImage).toMatchObject({ mode: "manage", value: "pending-resource://resource-1" });
        expect(ordinary.resources[0]).toMatchObject({ source: "ordinary.png" });

        await expect(prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([fakeFile("Main.md", `>[!personal-assistant]+ Featured Images\n> ![[one.png]]\n> ![[two.png]]`), fakeFile("one.png", "one"), fakeFile("two.png", "two")]),
            guard: allowAllGuard(), siteProfile: profile,
        })).rejects.toMatchObject({ code: "cover-ambiguous" });
    });

    it("lets explicit and ordinary covers override ambiguous management images", async () => {
        const body = [
            ">[!personal-assistant]+ Featured Images",
            "> ![[one.png]]",
            "",
            ">[!personal-assistant]- 题图",
            "> ![[two.png]]",
            "",
            "# Managed title",
        ].join("\n");
        const explicit = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([
                fakeFile("Main.md", `---\nghost:\n  feature_image: explicit.png\n---\n${body}`),
                fakeFile("one.png", "one"), fakeFile("two.png", "two"), fakeFile("explicit.png", "explicit"),
            ]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(explicit.fields.featureImage).toMatchObject({ mode: "manage", value: "pending-resource://resource-1" });
        expect(explicit.resources.map((resource) => resource.source)).toEqual(["explicit.png"]);
        expect(JSON.stringify(explicit.lexical)).not.toContain("Featured Images");
        expect(JSON.stringify(explicit.lexical)).not.toContain("题图");

        const cleared = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([
                fakeFile("Main.md", `---\nghost:\n  feature_image: null\n---\n${body}`),
                fakeFile("one.png", "one"), fakeFile("two.png", "two"),
            ]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(cleared.fields.featureImage).toEqual({ mode: "clear" });
        expect(cleared.resources).toEqual([]);
        expect(JSON.stringify(cleared.lexical)).not.toContain("Featured Images");

        const ordinary = await prepareGhostExport({
            targetPath: "Main.md",
            host: createHost([
                fakeFile("Main.md", `---\nfeature_image: ordinary.png\n---\n${body}`),
                fakeFile("one.png", "one"), fakeFile("two.png", "two"), fakeFile("ordinary.png", "ordinary"),
            ]),
            guard: allowAllGuard(), siteProfile: profile,
        });
        expect(ordinary.fields.featureImage).toMatchObject({ mode: "manage", value: "pending-resource://resource-1" });
        expect(ordinary.resources.map((resource) => resource.source)).toEqual(["ordinary.png"]);
        expect(JSON.stringify(ordinary.lexical)).not.toContain("题图");
    });

    it("expands an explicit block embed without its internal block marker", async () => {
        const result = await prepareGhostExport({
            targetPath: "Target.md",
            host: createHost([
                fakeFile("Target.md", "![[Dependency.md#^block-id]]"),
                fakeFile("Dependency.md", "Embedded block body ^block-id\n\nAfter block"),
            ]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        expect(JSON.stringify(result.lexical)).toContain("Embedded block body");
        expect(JSON.stringify(result.lexical)).not.toContain("^block-id");
        expect(result.sourceManifest.dependencies[1]).toMatchObject({
            path: "Dependency.md",
            kind: "embed",
            subpath: "block",
            subpathValue: "block-id",
        });
    });

    it("resolves embedded resources and diagnostics from their owning source", async () => {
        const result = await prepareGhostExport({
            targetPath: "A.md",
            host: createHost([
                fakeFile("A.md", "![[sub/B.md]]"),
                fakeFile("sub/B.md", "---\nx: y\n---\n![cover](cover.png)"),
                fakeFile("sub/cover.png", "correct binary"),
                fakeFile("cover.png", "wrong root binary"),
            ], { parseYaml: () => ({ x: "y" }) }),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        expect(result.resources).toHaveLength(1);
        expect(result.resources[0]).toMatchObject({
            kind: "local",
            source: "cover.png",
            resolvedPath: "sub/cover.png",
        });
        expect(result.resources[0].occurrences).toEqual([{ path: "sub/B.md", line: 3 }]);

        const inlineResult = await prepareGhostExport({
            targetPath: "A.md",
            host: createHost([
                fakeFile("A.md", "See ![[sub/B.md]]"),
                fakeFile("sub/B.md", "![cover](cover.png)"),
                fakeFile("sub/cover.png", "correct binary"),
                fakeFile("cover.png", "wrong root binary"),
            ]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        expect(inlineResult.resources[0]).toMatchObject({
            source: "cover.png",
            resolvedPath: "sub/cover.png",
        });
        expect(inlineResult.resources[0].occurrences).toEqual([{ path: "sub/B.md", line: 0 }]);

        const footnoteOwner = await prepareGhostExport({
            targetPath: "A.md",
            host: createHost([
                fakeFile("A.md", "See ![[sub/B.md]]"),
                fakeFile("sub/B.md", "![cover](cover.png)[^n].\n\n[^n]: Note"),
                fakeFile("sub/cover.png", "correct binary"),
                fakeFile("cover.png", "wrong root binary"),
            ]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        expect(footnoteOwner.resources[0]).toMatchObject({
            source: "cover.png",
            resolvedPath: "sub/cover.png",
        });
        expect(footnoteOwner.resources[0].occurrences).toEqual([{ path: "sub/B.md", line: 0 }]);

        const referenceOwner = await prepareGhostExport({
            targetPath: "A.md",
            host: createHost([
                fakeFile("A.md", "See ![[sub/B.md]]"),
                fakeFile("sub/B.md", "![cover]\n\n[cover]: cover.png"),
                fakeFile("sub/cover.png", "correct binary"),
                fakeFile("cover.png", "wrong root binary"),
            ]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        expect(referenceOwner.resources[0]).toMatchObject({
            source: "cover.png",
            resolvedPath: "sub/cover.png",
        });
        expect(referenceOwner.resources[0].occurrences).toEqual([{ path: "sub/B.md", line: 0 }]);

        const error = await prepareGhostExport({
            targetPath: "A.md",
            host: createHost([
                fakeFile("A.md", "![[sub/B.md]]"),
                fakeFile("sub/B.md", "---\nx: y\n---\n![missing](missing.png)"),
            ], { parseYaml: () => ({ x: "y" }) }),
            guard: allowAllGuard(),
            siteProfile: profile,
        }).catch((caught: unknown) => caught);
        expect(error).toMatchObject({
            code: "resource-not-found",
            path: "sub/B.md",
            line: 4,
        });
    });

    it("rejects unknown executable and unresolved resource constructs", async () => {
        const scriptHost = createHost([fakeFile("Script.md", "<script>window.alert(1)</script>")]);
        await expect(prepareGhostExport({
            targetPath: "Script.md",
            host: scriptHost,
            guard: allowAllGuard(),
            siteProfile: profile,
        })).rejects.toMatchObject({ code: "unknown-executable-content" });

        const dynamicHost = createHost([fakeFile("Dynamic.md", "```dataview\nList\n```")]);
        await expect(prepareGhostExport({
            targetPath: "Dynamic.md",
            host: dynamicHost,
            guard: allowAllGuard(),
            siteProfile: profile,
        })).rejects.toMatchObject({ code: "unknown-executable-content" });

        const imageHost = createHost([fakeFile("Image.md", "![missing](missing.png)")]);
        await expect(prepareGhostExport({
            targetPath: "Image.md",
            host: imageHost,
            guard: allowAllGuard(),
            siteProfile: profile,
        })).rejects.toMatchObject({ code: "resource-not-found" });
    });

    it("preserves callout, task-list, and footnote text and structure", async () => {
        const markdown = [
            "> [!note] Synthetic callout",
            "> Callout body remains visible.",
            "",
            "- [ ] [first task](https://example.invalid/task)",
            "- [x] ![task image](https://example.invalid/task.png)",
            "",
            "Reference[^a].",
            "",
            "[^a]: [Footnote body](https://example.invalid/footnote)",
            "",
        ].join("\n");
        const result = await prepareGhostExport({
            targetPath: "Structure.md",
            host: createHost([fakeFile("Structure.md", markdown)]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        const quote = result.lexical.root.children.find((node) => node.type === "extended-quote");
        expect(JSON.stringify(quote)).toContain("[!note] Synthetic callout");
        expect(JSON.stringify(quote)).toContain("Callout body remains visible.");
        const html = result.lexical.root.children.filter((node) => node.type === "html").map((node) => String(node.html));
        expect(html.some((value) => value.includes("pa-ghost-task-list") && value.includes('disabled') && value.includes('checked') && value.includes("first task") && value.includes("task image"))).toBe(true);
        expect(html.some((value) => value.includes('href="https://example.invalid/task"') && value.includes('alt="task image"'))).toBe(true);
        expect(html.some((value) => value.includes("pa-ghost-footnote-reference") && value.includes("user-content-fnref-a"))).toBe(true);
        expect(html.some((value) => value.includes("pa-ghost-footnotes") && value.includes('href="https://example.invalid/footnote"'))).toBe(true);
        expect(result.resources.map((resource) => resource.source)).toEqual(["https://example.invalid/task.png"]);
    });

    it("preserves table links and images plus following indented code", async () => {
        const markdown = [
            "| A | B |",
            "|---|---|",
            "| [site](https://example.invalid) | ![pic](https://example.invalid/x.png) |",
            "",
            "    indented-code",
            "",
        ].join("\n");
        const result = await prepareGhostExport({
            targetPath: "A.md",
            host: createHost([fakeFile("A.md", markdown)]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        const table = result.lexical.root.children.find((node) => node.type === "html");
        const tableHtml = String(table?.html);
        expect((tableHtml.match(/<thead>/g) ?? []).length).toBe(1);
        expect(tableHtml).toContain('<a href="https://example.invalid">site</a>');
        expect(tableHtml).toContain('alt="pic"');
        expect(result.resources).toMatchObject([{
            kind: "remote",
            source: "https://example.invalid/x.png",
            alt: "pic",
        }]);
        const code = result.lexical.root.children.find((node) => node.type === "codeblock");
        expect(code).toMatchObject({ code: "indented-code\n", language: "" });
        expect(result.lexical.root.children.map((node) => node.type)).toEqual(["html", "codeblock"]);
    });

    it("parses footnote references with surrounding inline content", async () => {
        const result = await prepareGhostExport({
            targetPath: "Footnote.md",
            host: createHost([fakeFile(
                "Footnote.md",
                "See [site](https://example.invalid) ![pic](https://example.invalid/pic.png)[^n].\n\n[^n]: Note",
            )]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        const html = result.lexical.root.children.filter((node) => node.type === "html").map((node) => String(node.html));
        expect(html.some((value) => value.includes('href="https://example.invalid"') && value.includes("site"))).toBe(true);
        expect(html.some((value) => value.includes('alt="pic"') && value.includes("user-content-fnref-n"))).toBe(true);
        expect(html.some((value) => value.includes("pa-ghost-footnotes") && value.includes("Note"))).toBe(true);
        expect(result.resources.map((resource) => resource.source)).toEqual(["https://example.invalid/pic.png"]);
    });

    it("keeps a parent task paragraph after a nested task list", async () => {
        const result = await prepareGhostExport({
            targetPath: "Task.md",
            host: createHost([fakeFile("Task.md", "- [ ] Parent\n  - Child\n\n  Parent tail")]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        const task = String(result.lexical.root.children[0]?.html);
        expect(task).toContain("Parent");
        expect(task).toContain("<li>Child</li>");
        expect(task).toContain("Parent tail");
    });

    it("protects inline and display math before Markdown emphasis rules", async () => {
        const result = await prepareGhostExport({
            targetPath: "Math.md",
            host: createHost([fakeFile("Math.md", "Math $a*b*c$ end.\n\n$$a *b* c$$")]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        const inline = result.lexical.root.children[0];
        const display = result.lexical.root.children[1];
        expect((inline.children as Array<{ text?: string }>)[1]?.text).toBe("\\(a*b*c\\)");
        expect(JSON.stringify(inline)).not.toMatch(/"format":2/);
        expect(String(display.html)).toContain("\\[a *b* c\\]");
        expect(result.capabilities.hasInlineMath).toBe(true);
        expect(result.capabilities.hasDisplayMath).toBe(true);
    });

    it("includes image identity in block semantics", async () => {
        const exportImage = async (source: string) => prepareGhostExport({
            targetPath: "Image.md",
            host: createHost([fakeFile("Image.md", `![same](${source})`)]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        const first = await exportImage("https://example.invalid/one.png");
        const changed = await exportImage("https://example.invalid/two.png");
        expect(first.blocks[0]?.semanticSignature).not.toBe(changed.blocks[0]?.semanticSignature);
        expect(first.resources[0]).toMatchObject({ source: "https://example.invalid/one.png" });
        expect(changed.resources[0]).toMatchObject({ source: "https://example.invalid/two.png" });
    });

    it("builds a fixed recipe and preserves manual injection verbatim", () => {
        const capabilities = {
            codeLanguages: ["typescript"],
            hasMermaid: true,
            hasInlineMath: true,
            hasDisplayMath: true,
        };
        const manualHead = "<!-- manual head -->";
        const manualFoot = "<!-- manual foot -->\n<style>.manual{color:red}</style>";
        const result = buildRecipeInjection(capabilities, {
            ...profile,
            manualHeadInjection: manualHead,
            manualFootInjection: manualFoot,
        });
        const urls = result.foot.split("\n").map((line) => /src="([^"]+)"/.exec(line)?.[1]).filter(Boolean);
        expect(urls).toEqual([
            "https://cdn.jsdelivr.net/npm/prismjs@1.30.0/components/prism-core.min.js",
            "https://cdn.jsdelivr.net/npm/prismjs@1.30.0/components/prism-clike.min.js",
            "https://cdn.jsdelivr.net/npm/prismjs@1.30.0/components/prism-javascript.min.js",
            "https://cdn.jsdelivr.net/npm/prismjs@1.30.0/components/prism-typescript.min.js",
            "https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/katex.min.js",
            "https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/contrib/auto-render.min.js",
            "https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.min.js",
        ]);
        expect(result.head.startsWith(manualHead)).toBe(true);
        expect(result.foot.includes(manualFoot)).toBe(true);
        expect(result.foot).toContain("display:true");
        expect(result.foot).not.toContain("<script type=\"module\">");

        const roundtrip = buildRecipeInjection(capabilities, {
            ...profile,
            manualHeadInjection: result.head,
            manualFootInjection: result.foot,
        });
        expect(roundtrip.head).toBe(result.head);
        expect(roundtrip.foot).toBe(result.foot);
        expect(roundtrip.manualHeadPreserved).toBe(true);
        expect(roundtrip.manualFootPreserved).toBe(true);

        const paddedRoundtrip = buildRecipeInjection(capabilities, {
            ...profile,
            manualHeadInjection: `\n\tkeep before\n${result.head}\n\tkeep after\n`,
        });
        expect(paddedRoundtrip.head).toBe(`\n\tkeep before\n${result.head}\n\tkeep after\n`);

        const changedCapabilities = { ...capabilities, hasMermaid: false, hasInlineMath: false, hasDisplayMath: false };
        const changed = buildRecipeInjection(changedCapabilities, {
            ...profile,
            manualHeadInjection: result.head,
            manualFootInjection: result.foot,
        });
        expect(changed.head).not.toBe(result.head);
        expect(changed.foot).not.toBe(result.foot);
        expect(changed.foot).not.toContain("mermaid.min.js");

        const reused = buildRecipeInjection(capabilities, {
            siteId: "site",
            prism: { compatible: true, evidence: "page-check" },
            mermaid: { compatible: true, evidence: "page-check" },
            katex: { compatible: true, evidence: "page-check" },
        });
        expect(reused.selection.reuse).toEqual({ prism: true, mermaid: true, katex: true });
        expect(reused.selection.footAssets).toEqual([]);
        expect(reused.head).not.toContain("window.Prism.manual=true");

        const modified = result.head.replace("prism.min.css", "changed.css");
        expect(() => buildRecipeInjection(capabilities, {
            ...profile,
            manualHeadInjection: modified,
        })).toThrow(GhostExportError);

        const orphan = result.head.replace(/<!-- pa-ghost:begin recipe head .*? -->\n/, "");
        expect(orphan).not.toContain("<!-- pa-ghost:begin recipe head ");
        expect(() => buildRecipeInjection(capabilities, {
            ...profile,
            manualHeadInjection: orphan,
        })).toThrow(GhostExportError);

        const malformed = result.head.replace(/hash=[0-9a-f]+/, "hash=invalid");
        expect(malformed).toContain("hash=invalid");
        expect(() => buildRecipeInjection(capabilities, {
            ...profile,
            manualHeadInjection: malformed,
        })).toThrow(GhostExportError);
    });

    it("distinguishes reused auto, reused explicit, and PA library initialization", async () => {
        const capabilities = {
            codeLanguages: ["typescript"],
            hasMermaid: true,
            hasInlineMath: true,
            hasDisplayMath: true,
        };
        const explicitProfile: SitePublishingProfile = {
            siteId: "explicit-site",
            prism: { compatible: true, evidence: "page-check", initialization: "explicit" },
            mermaid: { compatible: true, evidence: "page-check", initialization: "explicit" },
            katex: { compatible: true, evidence: "page-check", initialization: "explicit" },
        };
        const autoProfile: SitePublishingProfile = {
            siteId: "auto-site",
            prism: { compatible: true, evidence: "page-check", initialization: "auto" },
            mermaid: { compatible: true, evidence: "page-check", initialization: "auto" },
            katex: { compatible: true, evidence: "page-check", initialization: "auto" },
        };
        const pa = buildRecipeInjection(capabilities, profile);
        const explicit = buildRecipeInjection(capabilities, explicitProfile);
        const auto = buildRecipeInjection(capabilities, autoProfile);
        expect(pa.selection.loadsPrism).toBe(true);
        expect(explicit.selection.loadsPrism).toBe(false);
        expect(explicit.selection.initializesPrism).toBe(true);
        expect(explicit.selection.footAssets).toEqual([]);
        expect(auto.selection.initializesPrism).toBe(false);
        expect(auto.head).toContain('window.__paGhostRecipe.prism="reused-auto"');
        expect(auto.head).not.toContain("window.Prism.manual=true");

        const scripts = (value: string) => [...value.matchAll(/<script>([\s\S]*?)<\/script>/g)]
            .map((match) => match[1] ?? "");
        const initializePrism = (recipe: string) => {
            const highlightAllUnder = jest.fn();
            const windowScope = {
                __paGhostRecipe: {},
                Prism: {
                    manual: false,
                    languages: { javascript: {}, typescript: {} },
                    highlightAllUnder,
                },
            };
            for (const script of scripts(recipe)) {
                if (!script.includes("window.Prism")) continue;
                new Function("window", "document", script)(windowScope, { body: {} });
            }
            return { windowScope, highlightAllUnder };
        };
        const paPrism = initializePrism(`${pa.head}\n${pa.foot}`);
        expect(paPrism.highlightAllUnder).toHaveBeenCalledTimes(1);
        expect(paPrism.windowScope.__paGhostRecipe).toMatchObject({ prism: "loaded" });
        const reusedPrism = initializePrism(`${explicit.head}\n${explicit.foot}`);
        expect(reusedPrism.highlightAllUnder).toHaveBeenCalledTimes(1);
        expect(reusedPrism.windowScope.Prism.manual).toBe(false);

        const mermaidInitialize = jest.fn();
        const mermaidRun = jest.fn(async () => undefined);
        const mermaidWindow = {
            __paGhostRecipe: {},
            mermaid: { initialize: mermaidInitialize, run: mermaidRun },
        };
        for (const script of scripts(`${explicit.head}\n${explicit.foot}`)) {
            if (!script.includes("window.mermaid")) continue;
            await new Function("window", "document", script)(
                mermaidWindow,
                { querySelectorAll: () => [{ id: "mermaid-ok" }] },
            );
        }
        expect(mermaidInitialize).toHaveBeenCalledTimes(1);
        expect(mermaidRun).toHaveBeenCalledTimes(1);
        expect(mermaidWindow.__paGhostRecipe).toMatchObject({ mermaid: "rendered" });

        const renderMathInElement = jest.fn();
        const katexWindow = { __paGhostRecipe: {}, katex: {}, renderMathInElement };
        for (const script of scripts(`${explicit.head}\n${explicit.foot}`)) {
            if (!script.includes("renderMathInElement")) continue;
            new Function("window", "document", script)(katexWindow, { body: {} });
        }
        expect(renderMathInElement).toHaveBeenCalledTimes(1);
        expect(katexWindow.__paGhostRecipe).toMatchObject({ math: "loaded" });
    });

    it("uses actual export semantics for reliable format preservation", async () => {
        const exportBlock = async (markdown: string) => prepareGhostExport({
            targetPath: "Format.md",
            host: createHost([fakeFile("Format.md", markdown)]),
            guard: allowAllGuard(),
            siteProfile: profile,
        });
        const plain = await exportBlock("Hello world");
        const bold = await exportBlock("Hello **world**");
        expect(plain.blocks[0]?.semanticSignature).toBe(bold.blocks[0]?.semanticSignature);

        const linkedPlain = await exportBlock("[Hello world](https://example.invalid)");
        const linkedBold = await exportBlock("[Hello **world**](https://example.invalid)");
        expect(linkedPlain.blocks[0]?.semanticSignature).toBe(linkedBold.blocks[0]?.semanticSignature);

        const baseline = { ...plain.blocks[0]!, remoteBlockId: "remote-styled" };
        const styledRemote = {
            id: "remote-styled",
            semanticSignature: plain.blocks[0]!.semanticSignature,
            node: bold.lexical.root.children[0]!,
        };
        const preservedStyle = planFormatPreservation(
            plain.blocks,
            [styledRemote],
            [baseline],
        );
        expect(preservedStyle.status).toBe("ok");
        expect(preservedStyle.preservedNodes[0]?.node).toBe(bold.lexical.root.children[0]);

        const deleted = planFormatPreservation(plain.blocks, [], [baseline]);
        expect(deleted.status).toBe("needs-explicit-replace");
        expect(deleted.conflicts).toContainEqual({
            blockId: plain.blocks[0]!.id,
            reason: "remote-missing-block",
        });

        const duplicateCurrent = { ...plain.blocks[0]!, id: "block-duplicate", nodeIndex: 1 };
        const duplicateBaselines = [
            { ...plain.blocks[0]!, remoteBlockId: "remote-one" },
            { ...duplicateCurrent, remoteBlockId: "remote-two" },
        ];
        const duplicateRemotes = [
            { id: "remote-one", semanticSignature: plain.blocks[0]!.semanticSignature, node: plain.lexical.root.children[0]! },
            { id: "remote-two", semanticSignature: plain.blocks[0]!.semanticSignature, node: bold.lexical.root.children[0]! },
        ];
        const ambiguous = planFormatPreservation(
            [plain.blocks[0]!, duplicateCurrent],
            duplicateRemotes,
            duplicateBaselines,
        );
        expect(ambiguous.status).toBe("needs-explicit-replace");
        expect(ambiguous.preservedNodes).toEqual([]);
        expect(ambiguous.conflicts).toContainEqual({
            blockId: plain.blocks[0]!.id,
            reason: "ambiguous-signature",
        });

        const linkOne = await exportBlock("[site](https://example.invalid/one)");
        const linkTwo = await exportBlock("[site](https://example.invalid/two)");
        const changedLink = planFormatPreservation(linkOne.blocks, [{
            id: "remote-link",
            semanticSignature: linkTwo.blocks[0]!.semanticSignature,
            node: linkTwo.lexical.root.children[0]!,
        }], [{ ...linkOne.blocks[0]!, remoteBlockId: "remote-link" }]);
        expect(changedLink.status).toBe("needs-explicit-replace");
        expect(changedLink.conflicts[0]).toMatchObject({ reason: "remote-semantic-change" });
    });

    it("preserves only unique semantically matching remote blocks", () => {
        const block = {
            id: "block-1",
            nodeKind: "paragraph",
            sourcePath: "A.md",
            sourceDependencyIndex: 0,
            sourceStartLine: 0,
            sourceEndLine: 1,
            sourceHash: "source",
            semanticSignature: "semantic",
            nodeIndex: 0,
        };
        const remoteNode = { type: "paragraph", version: 1 };
        const baseline = { ...block, remoteBlockId: "remote-1" };
        const preserved = planFormatPreservation([block], [{
            id: "remote-1",
            semanticSignature: "semantic",
            node: remoteNode,
        }], [baseline]);
        expect(preserved.status).toBe("ok");
        expect(preserved.preservedNodes[0]?.node).toBe(remoteNode);

        const changed = planFormatPreservation([block], [{
            id: "remote-1",
            semanticSignature: "different",
            node: remoteNode,
        }], [baseline]);
        expect(changed.status).toBe("needs-explicit-replace");
        expect(changed.conflicts).toEqual([{ blockId: "block-1", reason: "remote-semantic-change" }]);

        const locallyChanged = { ...block, id: "block-local", sourceHash: "new-source", semanticSignature: "local-new" };
        const normalLocalEdit = planFormatPreservation([locallyChanged], [{
            id: "remote-1",
            semanticSignature: "semantic",
            node: remoteNode,
        }], [baseline]);
        expect(normalLocalEdit.status).toBe("ok");
        expect(normalLocalEdit.newBlocks).toEqual(["block-local"]);

        const inserted = { ...block, id: "block-inserted", sourceHash: "inserted", semanticSignature: "inserted" };
        const withInsert = planFormatPreservation([inserted, block], [{
            id: "remote-1",
            semanticSignature: "semantic",
            node: remoteNode,
        }], [baseline]);
        expect(withInsert.status).toBe("ok");
        expect(withInsert.newBlocks).toEqual(["block-inserted"]);
        expect(withInsert.preservedNodes.map((entry) => entry.blockId)).toEqual(["block-1"]);

        const duplicate = { ...block, id: "block-2" };
        const ambiguous = planFormatPreservation([block, duplicate], [
            { id: "remote-1", semanticSignature: "semantic", node: remoteNode },
            { id: "remote-2", semanticSignature: "semantic", node: remoteNode },
        ], [{ ...block }]);
        expect(ambiguous.status).toBe("needs-explicit-replace");
        expect(ambiguous.conflicts).toContainEqual({
            blockId: "block-1",
            reason: "ambiguous-signature",
        });
        expect(ambiguous.conflicts).toContainEqual({
            blockId: "remote-1",
            reason: "remote-extra-block",
        });
        expect(planFormatPreservation([block], [], [baseline], "replace-all").status).toBe("ok");
    });
});
