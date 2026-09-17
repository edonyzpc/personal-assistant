import { describe, expect, it, jest } from "@jest/globals";

import {
    createInspectObsidianNoteTool,
    type InspectObsidianNoteOutput,
} from "../src/ai-services/chat-tools";

jest.mock("obsidian");

type VaultFile = {
    path: string;
    basename?: string;
    stat?: { mtime?: number; ctime?: number; size?: number };
};
type FileCache = {
    frontmatter?: Record<string, unknown>;
    headings?: Array<{
        heading?: string;
        level?: number;
        position?: {
            start?: { line?: number; col?: number; offset?: number };
            end?: { line?: number; col?: number; offset?: number };
        };
    }>;
    tags?: Array<{ tag?: string }>;
    links?: Array<{ link?: string; original?: string }>;
    embeds?: Array<{ link?: string; original?: string }>;
    listItems?: unknown[];
    sections?: unknown[];
    blocks?: Record<string, unknown>;
};

function createHost(cache: FileCache | null, content = "# Current text\n- [ ] Cached task") {
    const cachedRead = jest.fn(async () => content);
    const file: VaultFile = {
        path: "notes/cache.md",
        basename: "cache",
        stat: { mtime: 1, ctime: 1, size: Buffer.byteLength(content, "utf8") },
    };
    return {
        host: {
            app: {
                vault: {
                    getMarkdownFiles: () => [file],
                    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
                    cachedRead,
                },
                metadataCache: {
                    getFileCache: () => cache,
                    resolvedLinks: {},
                    unresolvedLinks: {},
                },
            },
        } as never,
        cachedRead,
    };
}

async function inspect(host: never, input: Record<string, unknown> = { path: "notes/cache.md" }) {
    const result = await createInspectObsidianNoteTool().execute(input as never, { host });
    expect(result.ok).toBe(true);
    return result.content as InspectObsidianNoteOutput;
}

async function inspectResult(host: never, input: Record<string, unknown> = { path: "notes/cache.md" }) {
    return createInspectObsidianNoteTool().execute(input as never, { host });
}

describe("inspect_obsidian_note public cache-first structure", () => {
    it("does not read the body when the existing public cache is sufficient", async () => {
        const { host, cachedRead } = createHost({
            headings: [{ heading: "Cached heading", level: 2 }],
            tags: [{ tag: "#cached" }],
            links: [{ link: "notes/linked.md" }],
            embeds: [],
            listItems: [],
            sections: [],
            blocks: {},
        });

        const content = await inspect(host);

        expect(cachedRead).not.toHaveBeenCalled();
        expect(content.headings).toEqual([{ level: 2, text: "Cached heading" }]);
        expect(content.tags).toEqual(["cached"]);
        expect(content.wikilinks).toEqual(["notes/linked.md"]);
        expect(content.tasks).toEqual([]);
        expect(content.callouts).toEqual([]);
    });

    it("distinguishes a known-empty cache object from an unknown null cache", async () => {
        const knownEmpty = createHost({});
        const known = await inspect(knownEmpty.host);
        expect(knownEmpty.cachedRead).not.toHaveBeenCalled();
        expect(known.coverage).toMatchObject({ state: "complete", cacheState: "known" });

        const unknown = createHost(null, "# Fallback heading\n- [x] Fallback task");
        const unknownResult = await inspect(unknown.host);
        expect(unknown.cachedRead).toHaveBeenCalledTimes(1);
        expect(unknownResult.coverage).toMatchObject({ state: "partial", cacheState: "unknown" });
        expect(unknownResult.headings).toEqual([{ level: 1, text: "Fallback heading" }]);
        expect(unknownResult.tasks).toEqual([
            expect.objectContaining({ text: "Fallback task", status: "x", checked: true }),
        ]);
    });

    it("projects task text from cache positions and treats every non-space status as complete", async () => {
        const content = "# Tasks\n- [ ] Todo\n- [/] Forwarded\n- [?] Question";
        const { host, cachedRead } = createHost({
            listItems: [
                { task: " ", position: { start: { line: 1 }, end: { line: 1 } } },
                { task: "/", position: { start: { line: 2 }, end: { line: 2 } } },
                { task: "?", position: { start: { line: 3 }, end: { line: 3 } } },
            ],
        }, content);

        const result = await inspect(host);

        expect(cachedRead).toHaveBeenCalledTimes(1);
        expect(result.tasks).toEqual([
            expect.objectContaining({ line: 2, text: "Todo", status: " ", checked: false }),
            expect.objectContaining({ line: 3, text: "Forwarded", status: "/", checked: true }),
            expect.objectContaining({ line: 4, text: "Question", status: "?", checked: true }),
        ]);
    });

    it("accepts official ATX closing hashes and Setext headings from cached positions", async () => {
        const content = "# Title #\nSetext\n===\n1. [ ] Ordered";
        const { host } = createHost({
            headings: [
                { heading: "Title", level: 1, position: { start: { line: 0 }, end: { line: 0 } } },
                { heading: "Setext", level: 1, position: { start: { line: 1 }, end: { line: 2 } } },
            ],
            listItems: [
                { task: " ", position: { start: { line: 3 }, end: { line: 3 } } },
            ],
        }, content);

        const result = await inspect(host);

        expect(result.headings).toEqual([
            { level: 1, text: "Title" },
            { level: 1, text: "Setext" },
        ]);
    });

    it("keeps a literal trailing hash and validates headings at public cache positions", async () => {
        const content = "# C#\r\n> # Quoted heading\r\n- [ ] Task";
        const { host } = createHost({
            headings: [
                {
                    heading: "C#",
                    level: 1,
                    position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 4, offset: 4 } },
                },
                {
                    heading: "Quoted heading",
                    level: 1,
                    position: { start: { line: 1, col: 2, offset: 8 }, end: { line: 1, col: 22, offset: 23 } },
                },
            ],
            listItems: [
                { task: " ", position: { start: { line: 2, col: 0, offset: 26 }, end: { line: 2, col: 11, offset: 37 } } },
            ],
        }, content);

        const result = await inspect(host);

        expect(result.headings).toEqual([
            { level: 1, text: "C#" },
            { level: 1, text: "Quoted heading" },
        ]);
    });

    it("projects ordered, nested, and quoted tasks from official list-item positions", async () => {
        const content = "1. [ ] Ordered\n  2. [x] Nested\n> 3. [ ] Quoted";
        const { host } = createHost({
            listItems: [
                { task: " ", position: { start: { line: 0 }, end: { line: 0 } } },
                { task: "x", position: { start: { line: 1 }, end: { line: 1 } } },
                { task: " ", position: { start: { line: 2 }, end: { line: 2 } } },
            ],
        }, content);

        const result = await inspect(host);
        const mismatch = await inspectResult(createHost({
            listItems: [
                { task: " ", position: { start: { line: 0 }, end: { line: 0 } } },
            ],
        }, "plain text\n1. [ ] Real task").host);

        expect(result.tasks).toEqual([
            expect.objectContaining({ line: 1, text: "Ordered", status: " ", checked: false }),
            expect.objectContaining({ line: 2, text: "Nested", status: "x", checked: true }),
            expect.objectContaining({ line: 3, text: "Quoted", status: " ", checked: false }),
        ]);
        expect(mismatch.ok).toBe(false);
        expect(mismatch.error).toContain("cache is not synchronized");
    });

    it("locates a task in ordered and quoted containers from public offsets", async () => {
        const content = "1. > - [ ] Container task";
        const { host } = createHost({
            listItems: [
                { task: " ", position: { start: { line: 0, col: 5, offset: 5 }, end: { line: 0, col: 24, offset: 24 } } },
            ],
        }, content);
        const mismatch = createHost({
            listItems: [
                { task: " ", position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 24, offset: 24 } } },
            ],
        }, content);

        const result = await inspect(host);
        const mismatchResult = await inspectResult(mismatch.host);

        expect(result.tasks).toEqual([
            expect.objectContaining({ line: 1, text: "Container task", status: " ", checked: false }),
        ]);
        expect(mismatchResult.ok).toBe(false);
        expect(mismatchResult.error).toContain("cache is not synchronized");
    });

    it("uses bounded section candidates without labeling every blockquote a callout", async () => {
        const content = "# Note\n\n- > [!warning] Nested callout\n> Ordinary quote\n> [!note] Top-level callout";
        const { host, cachedRead } = createHost({
            sections: [
                { type: "list", position: { start: { line: 2 }, end: { line: 2 } } },
                { type: "blockquote", position: { start: { line: 3 }, end: { line: 4 } } },
            ],
        }, content);

        const result = await inspect(host);

        expect(cachedRead).toHaveBeenCalledTimes(1);
        expect(result.callouts).toEqual([
            expect.objectContaining({ line: 3, type: "warning", title: "Nested callout" }),
            expect.objectContaining({ line: 5, type: "note", title: "Top-level callout" }),
        ]);
    });

    it("supports nested real callouts and excludes callout syntax inside a fenced blockquote", async () => {
        const nestedContent = "> [!note] Outer\n> > [!tip] Inner";
        const nested = await inspect(createHost({
            sections: [
                { type: "callout", position: { start: { line: 0 }, end: { line: 1 } } },
            ],
        }, nestedContent).host);
        expect(nested.callouts).toEqual([
            expect.objectContaining({ line: 1, type: "note", title: "Outer" }),
            expect.objectContaining({ line: 2, type: "tip", title: "Inner" }),
        ]);

        const fencedContent = "> [!note] Real\n> ```markdown\n> > [!warning] Fake\n> ```";
        const fenced = await inspect(createHost({
            sections: [
                { type: "blockquote", position: { start: { line: 0 }, end: { line: 3 } } },
            ],
        }, fencedContent).host);
        expect(fenced.callouts).toEqual([
            expect.objectContaining({ line: 1, type: "note", title: "Real" }),
        ]);
    });

    it("extracts complete custom callout types and folded-title syntax", async () => {
        const content = "> [!custom-callout] Title\n> [!note]- Folded title\n> Ordinary quote";
        const result = await inspect(createHost({
            sections: [
                { type: "callout", position: { start: { line: 0 }, end: { line: 2 } } },
            ],
        }, content).host);

        expect(result.callouts).toEqual([
            expect.objectContaining({ line: 1, type: "custom-callout", title: "Title" }),
            expect.objectContaining({ line: 2, type: "note", title: "Folded title" }),
        ]);
    });

    it("does not pair stale cached properties with a newly read body", async () => {
        const content = "---\nstatus: new\n---\n1. [ ] Current task";
        const cache = {
            frontmatter: { status: "old" },
            listItems: [
                { task: " ", position: { start: { line: 3 }, end: { line: 3 } } },
            ],
        };
        const stale = await inspectResult(createHost(cache, content).host);
        expect(stale.ok).toBe(false);
        expect(stale.error).toContain("cache is not synchronized");

        const current = await inspect(createHost({
            ...cache,
            frontmatter: { status: "new" },
        }, content).host);
        expect(current.properties).toEqual({ status: "new" });
    });

    it("treats absent frontmatter as a state in both directions", async () => {
        const presentBody = "---\ntags: [new]\n---\n- [ ] Task";
        const cacheWithoutFrontmatter = {
            listItems: [
                { task: " ", position: { start: { line: 3 }, end: { line: 3 } } },
            ],
        };
        const added = await inspectResult(createHost(cacheWithoutFrontmatter, presentBody).host);
        expect(added.ok).toBe(false);
        expect(added.error).toContain("cache is not synchronized");

        const removed = await inspectResult(createHost({
            frontmatter: { tags: ["old"] },
            listItems: [
                { task: " ", position: { start: { line: 0 }, end: { line: 0 } } },
            ],
        }, "- [ ] Task").host);
        expect(removed.ok).toBe(false);
        expect(removed.error).toContain("cache is not synchronized");

        const unchangedAbsent = await inspect(createHost({
            listItems: [
                { task: " ", position: { start: { line: 0 }, end: { line: 0 } } },
            ],
        }, "- [ ] Task").host);
        expect(unchangedAbsent.properties).toEqual({});
    });

    it("does not claim cache-set completeness after validating only existing structure items", async () => {
        const { host, cachedRead } = createHost({
            headings: [],
            listItems: [
                { task: " ", position: { start: { line: 0 }, end: { line: 0 } } },
            ],
        }, "- [ ] Existing task\n# New heading");

        const result = await inspect(host);

        expect(cachedRead).toHaveBeenCalledTimes(1);
        expect(result.tasks).toEqual([
            expect.objectContaining({ text: "Existing task", status: " ", checked: false }),
        ]);
        expect(result.headings).toEqual([]);
        expect(result.coverage).toMatchObject({
            state: "partial",
            cacheState: "known",
            cacheCoverage: "existing-items-only",
        });
    });

    it("fails rather than mixing a cache-position mismatch with current text", async () => {
        const content = "# Current\n- [ ] Current task";
        const { host } = createHost({
            listItems: [{ task: " ", position: { start: { line: 0 }, end: { line: 0 } } }],
        }, content);
        const result = await createInspectObsidianNoteTool().execute(
            { path: "notes/cache.md" } as never,
            { host },
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain("cache is not synchronized");
    });

    it("excludes YAML and fenced pseudo-structure in the cache-missing fallback parser", async () => {
        const content = [
            "---",
            "# Not a heading",
            "- [ ] Not a task",
            "---",
            "# Real heading",
            "```markdown",
            "- [ ] Fake task",
            "> [!warning] Fake callout",
            "[[fake-link.md]] #fake-tag",
            "```",
        ].join("\n");
        const { host } = createHost(null, content);

        const result = await inspect(host);

        expect(result.headings).toEqual([{ level: 1, text: "Real heading" }]);
        expect(result.tasks).toEqual([]);
        expect(result.callouts).toEqual([]);
        expect(result.wikilinks).toEqual([]);
        expect(result.tags).toEqual([]);
    });

    it("bounds backlink evaluation, keeps nonmatch dependencies, and does not read excluded sources", async () => {
        const target = "notes/target.md";
        const sources = Array.from({ length: 502 }, (_, index) => `notes/source-${index}.md`);
        const resolvedLinks: Record<string, Record<string, number>> = {};
        for (const [index, source] of sources.entries()) {
            Object.defineProperty(resolvedLinks, source, {
                enumerable: true,
                get: () => {
                    if (source === "notes/source-501.md") throw new Error("Excluded source getter must not run");
                    return index === 500 ? {} : { [target]: 1 };
                },
            });
        }
        const file = { path: target, basename: "target" };
        const cachedRead = jest.fn(async () => "");
        const host = {
            app: {
                vault: {
                    getMarkdownFiles: () => [file],
                    getAbstractFileByPath: (path: string) => path === target ? file : null,
                    cachedRead,
                },
                metadataCache: {
                    getFileCache: () => ({}),
                    resolvedLinks,
                    unresolvedLinks: {},
                },
            },
        } as never;
        const tool = createInspectObsidianNoteTool({
            isPathAllowed: path => path === target
                || (path.startsWith("notes/source-") && path !== "notes/source-501.md"),
        });
        const result = await tool.execute({ path: target } as never, { host });

        expect(result.ok).toBe(true);
        expect(result.content?.backlinks).toHaveLength(60);
        expect(result.content?.coverage).toMatchObject({
            state: "partial",
            evaluatedBacklinkSources: 500,
            backlinkScanCapExceeded: true,
        });
        expect(result.sourceRecords?.filter(record => record.metadata?.sourceDependency === true))
            .toHaveLength(500);
        expect(JSON.stringify(result.sourceRecords)).not.toContain("source-501");
    });

    it("reads only bounded permitted backlink facts with and without a task-source guard", async () => {
        const target = "notes/target.md";
        const buildHost = () => {
            const resolvedLinks: Record<string, Record<string, number>> = {};
            const getterCalls: string[] = [];
            for (let index = 0; index < 502; index++) {
                const source = `notes/source-${index}.md`;
                Object.defineProperty(resolvedLinks, source, {
                    enumerable: true,
                    get: () => {
                        getterCalls.push(source);
                        if (index >= 501) throw new Error("Permitted source beyond the cap must not be read");
                        return index === 500 ? {} : { [target]: 1 };
                    },
                });
            }
            const file = { path: target, basename: "target", stat: { mtime: 1, size: 10 } };
            return {
                getterCalls,
                host: {
                    app: {
                        vault: {
                            getMarkdownFiles: () => [file],
                            getAbstractFileByPath: (path: string) => path === target ? file : null,
                            cachedRead: jest.fn(async () => ""),
                        },
                        metadataCache: {
                            getFileCache: () => ({}),
                            resolvedLinks,
                            unresolvedLinks: {},
                        },
                    },
                } as never,
            };
        };

        const unguardedHost = buildHost();
        const unguarded = await createInspectObsidianNoteTool({ isPathAllowed: () => true })
            .execute({ path: target } as never, { host: unguardedHost.host });
        expect(unguarded.ok).toBe(true);
        expect(unguarded.content?.coverage).toMatchObject({
            state: "partial",
            evaluatedBacklinkSources: 500,
            backlinkScanCapExceeded: true,
        });
        expect(unguardedHost.getterCalls).toEqual(Array.from({ length: 500 }, (_, index) => `notes/source-${index}.md`));

        const guardedHost = buildHost();
        const guarded = await createInspectObsidianNoteTool({ isPathAllowed: () => true })
            .execute({ path: target } as never, {
                host: guardedHost.host,
                taskSourceReadGuard: {
                    isCurrent: () => true,
                    isPathAllowed: () => true,
                },
            } as never);
        expect(guarded.ok).toBe(true);
        expect(guarded.content?.coverage).toMatchObject({
            state: "partial",
            evaluatedBacklinkSources: 500,
            backlinkScanCapExceeded: true,
        });
        expect(guardedHost.getterCalls).toEqual(Array.from({ length: 500 }, (_, index) => `notes/source-${index}.md`));
    });

    it("returns exact bounded backlink coverage below the cap with nonmatch dependencies", async () => {
        const target = "notes/target.md";
        const resolvedLinks: Record<string, Record<string, number>> = {
            "notes/z.md": {},
            "notes/a.md": { [target]: 1 },
            "notes/m.md": {},
        };
        const file = { path: target, basename: "target", stat: { mtime: 1, size: 10 } };
        const host = {
            app: {
                vault: {
                    getMarkdownFiles: () => [file],
                    getAbstractFileByPath: (path: string) => path === target ? file : null,
                    cachedRead: jest.fn(async () => ""),
                },
                metadataCache: {
                    getFileCache: () => ({}),
                    resolvedLinks,
                    unresolvedLinks: {},
                },
            },
        } as never;
        const result = await createInspectObsidianNoteTool().execute({ path: target } as never, { host });

        expect(result.ok).toBe(true);
        expect(result.content?.backlinks).toEqual(["notes/a.md"]);
        expect(result.content?.coverage).toMatchObject({
            state: "complete",
            evaluatedBacklinkSources: 3,
        });
        expect(result.sourceRecords?.filter(record => record.metadata?.sourceDependency === true))
            .toHaveLength(3);
    });

    it("rechecks inspect file identity and stat after a necessary body read", async () => {
        const invoke = async (mutation: "replace" | "rename" | "stat" | "none") => {
            const content = "# Body\n- [ ] Task";
            const file = {
                path: "notes/mutable.md",
                basename: "mutable",
                stat: { mtime: 10, ctime: 5, size: Buffer.byteLength(content, "utf8") },
            };
            let currentFile = file;
            const cachedRead = jest.fn(async () => {
                await Promise.resolve();
                if (mutation === "replace") currentFile = { ...file };
                if (mutation === "rename") file.path = "notes/renamed.md";
                if (mutation === "stat") file.stat!.mtime = 99;
                return content;
            });
            const host = {
                app: {
                    vault: {
                        getMarkdownFiles: () => [currentFile],
                        getAbstractFileByPath: (path: string) => currentFile.path === path ? currentFile : null,
                        cachedRead,
                    },
                    metadataCache: {
                        getFileCache: () => ({
                            listItems: [
                                { task: " ", position: { start: { line: 1 }, end: { line: 1 } } },
                            ],
                        }),
                        resolvedLinks: {},
                        unresolvedLinks: {},
                    },
                },
            } as never;
            return createInspectObsidianNoteTool().execute({ path: "notes/mutable.md" } as never, { host });
        };

        await expect(invoke("replace")).rejects.toThrow("Note source changed");
        await expect(invoke("rename")).rejects.toThrow("Note source changed");
        await expect(invoke("stat")).rejects.toThrow("Note source stat changed");
        const stable = await invoke("none");
        expect(stable.ok).toBe(true);
        expect(stable.content?.tasks).toEqual([
            expect.objectContaining({ text: "Task", status: " ", checked: false }),
        ]);
    });
});
