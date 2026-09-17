import { describe, expect, it, jest } from "@jest/globals";

import {
    createSearchVaultSnippetsTool,
    type VaultSnippetSearchOutput,
} from "../src/ai-services/chat-tools";
import { enforceToolOutputBudget } from "../src/ai-services/chat-tool-registry";
import type { ChatToolRegistryDefinition } from "../src/ai-services/chat-tool-types";
import { computeContentHash } from "../src/vss-helpers";

jest.mock("obsidian");
jest.mock("../src/vss-helpers", () => ({
    computeContentHash: jest.fn(async (input: string) => {
        const { createHash } = jest.requireActual("node:crypto") as typeof import("node:crypto");
        return createHash("sha1").update(input, "utf8").digest("hex");
    }),
}));

const searchTool = createSearchVaultSnippetsTool();

type VaultFile = {
    path: string;
    basename?: string;
    stat?: { mtime?: number; ctime?: number; size?: number };
};

function createHost(options: {
    markdownFiles?: VaultFile[];
    fileContents?: Record<string, string>;
    getMarkdownFiles?: () => VaultFile[];
    preserveMissingStat?: boolean;
}) {
    const markdownFiles = (options.markdownFiles ?? []).map(file => ({
        ...file,
        stat: (!options.preserveMissingStat && file.stat === undefined) ? {
            mtime: 1,
            size: Buffer.byteLength(options.fileContents?.[file.path] ?? "", "utf8"),
        } : file.stat,
    }));
    const cachedRead = jest.fn(async (file: VaultFile) => options.fileContents?.[file.path] ?? "");
    return {
        host: {
            app: {
                vault: {
                    getMarkdownFiles: options.getMarkdownFiles ?? (() => markdownFiles),
                    getAbstractFileByPath: (path: string) => markdownFiles.find(file => file.path === path) ?? null,
                    cachedRead,
                },
                metadataCache: {
                    getFileCache: () => null,
                    resolvedLinks: {},
                    unresolvedLinks: {},
                },
            },
        } as never,
        cachedRead,
        hostFiles: markdownFiles,
    };
}

async function execute(host: never, input: Record<string, unknown>) {
    const result = await searchTool.execute(
        searchTool.validateInput(input) as never,
        { host },
    );
    if (!result.ok) throw new Error(result.error);
    return result.content as VaultSnippetSearchOutput;
}

describe("search_vault_snippets multi-match source locating", () => {
    it("keeps original UTF-16 offsets and line/column ranges for NFKC-sensitive text", async () => {
        const content = `${"ﬃ".repeat(120)}\nneedle`;
        const { host } = createHost({
            markdownFiles: [{ path: "notes/unicode.md", basename: "unicode" }],
            fileContents: { "notes/unicode.md": content },
        });

        const result = await execute(host, { query: "needle", scope: "notes/unicode.md" });
        const first = result.matches[0];

        expect(first?.line).toBe(2);
        expect(first?.range).toEqual({
            startOffset: 121,
            endOffset: 127,
            startLine: 2,
            endLine: 2,
            startColumn: 1,
            endColumn: 7,
        });
    });

    it("returns every match in one file across pages without duplicates", async () => {
        const content = "needle alpha\nmiddle\nneedle beta";
        const files = [{ path: "notes/multi.md", basename: "multi", stat: { mtime: 2, size: Buffer.byteLength(content) } }];
        const fileContents: Record<string, string> = { "notes/multi.md": content };
        const { host, cachedRead } = createHost({ markdownFiles: files, fileContents });

        const first = await execute(host, {
            query: "needle",
            scope: "notes/multi.md",
            limit: 1,
        });
        expect(first.matches).toHaveLength(1);
        expect(first.matches[0]?.range.startOffset).toBe(0);
        expect(typeof first.nextCursor).toBe("string");

        const second = await execute(host, {
            query: "needle",
            scope: "notes/multi.md",
            limit: 1,
            cursor: first.nextCursor,
        });
        expect(second.matches).toHaveLength(1);
        expect(second.matches[0]?.range.startOffset).toBe(20);
        expect(second.nextCursor).toBeUndefined();
        expect(cachedRead).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(second).length).toBeLessThanOrEqual(6000);
    });

    it("searches saved properties and body separately with literal case and whitespace semantics", async () => {
        const content = "---\nstatus: needle\n---\nAlpha NeedLE tail";
        const { host } = createHost({
            markdownFiles: [{ path: "notes/parts.md", basename: "parts" }],
            fileContents: { "notes/parts.md": content },
        });

        const properties = await execute(host, {
            query: "needle",
            part: "properties",
            scope: "notes/parts.md",
        });
        const body = await execute(host, {
            query: "needle",
            part: "body",
            scope: "notes/parts.md",
        });
        const all = await execute(host, {
            query: " needle ",
            scope: "notes/parts.md",
        });
        const exactCase = await execute(host, {
            query: " needle ",
            caseSensitive: true,
            scope: "notes/parts.md",
        });

        expect(properties.matches.map(match => match.part)).toEqual(["properties"]);
        expect(properties.matchCount).toBe(1);
        expect(body.matches.map(match => match.part)).toEqual(["body"]);
        expect(all.matches.map(match => match.part)).toEqual(["body"]);
        expect(exactCase.matches).toEqual([]);
        expect(searchTool.prepareArguments?.({ q: "  preserved query  " }, { userInput: "" })).toEqual({
            query: "  preserved query  ",
        });
        expect(() => searchTool.validateInput({ query: " \t\r\n" })).toThrow("non-empty");
        expect(() => searchTool.validateInput({ query: "x".repeat(161) })).toThrow("at most 160");
    });

    it("keeps CRLF and cross-line ranges anchored to original UTF-16 offsets", async () => {
        const content = "---\r\ntitle: draft\r\n---\r\nAlpha needle\r\nnext line";
        const { host } = createHost({
            markdownFiles: [{ path: "notes/crlf.md", basename: "crlf" }],
            fileContents: { "notes/crlf.md": content },
        });

        const result = await execute(host, {
            query: "needle\r\nnext",
            part: "body",
            scope: "notes/crlf.md",
        });
        const range = result.matches[0]?.range;

        expect(range).toEqual({
            startOffset: content.indexOf("needle\r\nnext"),
            endOffset: content.indexOf("needle\r\nnext") + "needle\r\nnext".length,
            startLine: 4,
            endLine: 5,
            startColumn: 7,
            endColumn: 5,
        });
    });

    it("expires a cursor when same-stat match text, a nonmatch source, or the file set changes", async () => {
        const files = [
            { path: "notes/a.md", basename: "a", stat: { mtime: 10, size: 14 } },
            { path: "notes/b.md", basename: "b", stat: { mtime: 11, size: 12 } },
        ];
        const fileContents: Record<string, string> = {
            "notes/a.md": "needle one\nneedle two\n",
            "notes/b.md": "no match here",
        };
        const { host, hostFiles } = createHost({ markdownFiles: files, fileContents });
        const first = await execute(host, { query: "needle", scope: "notes", limit: 1 });
        expect(first.nextCursor).toBeTruthy();

        fileContents["notes/a.md"] = "other one\nother two\n";
        await expect(execute(host, {
            query: "needle",
            scope: "notes",
            limit: 1,
            cursor: first.nextCursor,
        })).rejects.toThrow("snapshot is no longer current");

        fileContents["notes/a.md"] = "needle one\nneedle two\n";
        const nonmatchCursor = await execute(host, {
            query: "needle",
            scope: "notes",
            limit: 1,
        });
        fileContents["notes/b.md"] = "no match there";
        await expect(execute(host, {
            query: "needle",
            scope: "notes",
            limit: 1,
            cursor: nonmatchCursor.nextCursor,
        })).rejects.toThrow("snapshot is no longer current");

        const third = await execute(host, {
            query: "needle",
            scope: "notes",
            limit: 1,
        });
        hostFiles.push({
            path: "notes/c.md",
            basename: "c",
            stat: { mtime: 12, size: 7 },
        });
        fileContents["notes/c.md"] = "needle";
        await expect(execute(host, {
            query: "needle",
            scope: "notes",
            limit: 1,
            cursor: third.nextCursor,
        })).rejects.toThrow("snapshot is no longer current");
    });

    it("marks unknown size and scan overruns partial without a whole-range cursor", async () => {
        const unknownSize = await execute(hostWithFile({ stat: undefined }), {
            query: "needle",
            scope: "notes/a.md",
        });
        expect(unknownSize.matches).toEqual([]);
        expect(unknownSize.coverage).toMatchObject({ state: "partial", unknownFileSize: true });
        expect(unknownSize.nextCursor).toBeUndefined();
        expect(unknownSize.partialResultGuidance).toContain("Narrow the scope");

        const oversized = await execute(hostWithFile({
            stat: { mtime: 1, size: 100_001 },
        }), { query: "needle", scope: "notes/a.md" });
        expect(oversized.coverage).toMatchObject({
            state: "partial",
            skippedFiles: 1,
        });
        expect(oversized.skippedSources).toContain("vault file read skipped for size");
        expect(oversized.nextCursor).toBeUndefined();
    });

    it("fails closed when Markdown enumeration is unavailable", async () => {
        const host = {
            app: {
                vault: {
                    getAbstractFileByPath: () => null,
                    cachedRead: jest.fn(async () => "needle"),
                },
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;

        await expect(execute(host, { query: "needle" })).rejects.toThrow("getMarkdownFiles is unavailable");
    });

    it("rejects an in-place stat change after another file is read and after the final snapshot hash", async () => {
        const files = [
            { path: "notes/a.md", basename: "a", stat: { mtime: 1, size: 9 } },
            { path: "notes/b.md", basename: "b", stat: { mtime: 2, size: 9 } },
        ];
        const fileContents: Record<string, string> = {
            "notes/a.md": "needle one",
            "notes/b.md": "needle two",
        };
        let readFirstFile = false;
        const cachedRead = jest.fn(async (file: VaultFile) => {
            if (file.path === "notes/a.md") {
                readFirstFile = true;
            } else if (readFirstFile) {
                files[0]!.stat!.mtime = 99;
            }
            return fileContents[file.path] ?? "";
        });
        const host = {
            app: {
                vault: {
                    getMarkdownFiles: () => files,
                    getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
                    cachedRead,
                },
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;

        const result = await searchTool.execute(
            searchTool.validateInput({ query: "needle", scope: "notes" }) as never,
            { host },
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain("sources changed");

        const stableFiles = [
            { path: "notes/a.md", basename: "a", stat: { mtime: 1, size: 9 } },
            { path: "notes/b.md", basename: "b", stat: { mtime: 2, size: 9 } },
        ];
        const stableRead = jest.fn(async (file: VaultFile) => fileContents[file.path] ?? "");
        const stableHost = {
            app: {
                vault: {
                    getMarkdownFiles: () => stableFiles,
                    getAbstractFileByPath: (path: string) => stableFiles.find(file => file.path === path) ?? null,
                    cachedRead: stableRead,
                },
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;
        await expect(execute(stableHost, { query: "needle", scope: "notes" })).resolves.toMatchObject({
            matchCount: 2,
        });

        const hashMock = computeContentHash as jest.Mock;
        const digest = async (input: unknown) => {
            const value = input as string;
            try {
                const parsed = JSON.parse(value) as Array<{ path?: string }>;
                if (Array.isArray(parsed) && parsed[0]?.path === "notes/a.md") {
                    stableFiles[0]!.stat!.mtime = 100;
                }
            } catch {
                // Non-snapshot hashes are returned unchanged below.
            }
            const { createHash } = jest.requireActual("node:crypto") as typeof import("node:crypto");
            return createHash("sha1").update(value, "utf8").digest("hex");
        };
        const originalHash = hashMock.getMockImplementation();
        hashMock.mockImplementation(digest);
        let finalHashResult: Awaited<ReturnType<typeof searchTool.execute>>;
        try {
            finalHashResult = await searchTool.execute(
                searchTool.validateInput({ query: "needle", scope: "notes" }) as never,
                { host: stableHost },
            );
        } finally {
            hashMock.mockImplementation(originalHash ?? digest);
        }
        expect(finalHashResult.ok).toBe(false);
        expect(finalHashResult.error).toContain("sources changed");
    });

    it("reports a candidate-budget partial without treating the unvisited file as a source-set change", async () => {
        const makeFiles = (count: number) => Array.from({ length: count }, (_, index) => {
            const path = `notes/candidate-${String(index).padStart(3, "0")}.md`;
            if (index < 400) {
                return {
                    path,
                    basename: `candidate-${index}`,
                    stat: { mtime: index + 1, size: 0 },
                };
            }
            return {
                path,
                basename: `candidate-${index}`,
                get stat(): never {
                    throw new Error("Candidate-cap-outside stat must not be read");
                },
            };
        });
        const makeHost = (files: VaultFile[]) => {
            const cachedRead = jest.fn(async (file: VaultFile) => {
                if (files.indexOf(file) >= 400) {
                    throw new Error("Candidate-cap-outside body must not be read");
                }
                return "";
            });
            return {
                host: {
                    app: {
                        vault: {
                            getMarkdownFiles: () => files,
                            getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
                            cachedRead,
                        },
                        metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
                    },
                } as never,
                cachedRead,
            };
        };

        const atCap = makeHost(makeFiles(400));
        const atCapResult = await execute(atCap.host, { query: "needle", scope: "notes" });
        expect(atCapResult.coverage).toMatchObject({
            state: "partial",
            evaluatedCandidates: 400,
            readNotes: 80,
            skippedFiles: 320,
            fileCapExceeded: true,
        });

        const overCapFiles = makeFiles(401);
        const overCap = makeHost(overCapFiles);
        const overCapResult = await execute(overCap.host, { query: "needle", scope: "notes" });
        expect(overCapResult.coverage).toMatchObject({
            state: "partial",
            evaluatedCandidates: 400,
            readNotes: 80,
            skippedFiles: 320,
            candidateCapExceeded: true,
            fileCapExceeded: true,
        });
        expect(overCap.cachedRead).toHaveBeenCalledTimes(80);

        const mutateDuringSnapshotHash = async (
            mutation: (files: VaultFile[]) => void,
        ) => {
            const files = makeFiles(401);
            const host = makeHost(files);
            const hashMock = computeContentHash as jest.Mock;
            const originalHash = hashMock.getMockImplementation();
            const digest = async (input: unknown) => {
                try {
                    const parsed = JSON.parse(String(input)) as Array<{ path?: string }>;
                    if (Array.isArray(parsed) && parsed.length === 400) mutation(files);
                } catch {
                    // Content hashes are strings and intentionally do not trigger the mutation.
                }
                const { createHash } = jest.requireActual("node:crypto") as typeof import("node:crypto");
                return createHash("sha1").update(String(input), "utf8").digest("hex");
            };
            hashMock.mockImplementation(digest);
            try {
                return await searchTool.execute(
                    searchTool.validateInput({ query: "needle", scope: "notes" }) as never,
                    { host: host.host },
                );
            } finally {
                hashMock.mockImplementation(originalHash ?? digest);
            }
        };

        await expect(mutateDuringSnapshotHash(files => {
            files.push({ path: "notes/new-outside-cap.md", basename: "new-outside-cap" });
        })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("changed while snippets") });
        await expect(mutateDuringSnapshotHash(files => {
            files.splice(400, 1);
        })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("changed while snippets") });
        await expect(mutateDuringSnapshotHash(files => {
            files[400] = { path: "notes/candidate-400.md", basename: "candidate-400" };
        })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("changed while snippets") });
    });

    it("derives visible sources from the budgeted page and continues without duplicate matches", async () => {
        const files = Array.from({ length: 10 }, (_, index) => ({
            path: `notes/${"long-".repeat(80)}-${index}.md`,
            basename: `long-${index}`,
        }));
        const fileContents = Object.fromEntries(files.map(file => [file.path, `needle ${"x".repeat(250)}`]));
        const { host } = createHost({ markdownFiles: files, fileContents });

        const firstResult = await searchTool.execute(
            searchTool.validateInput({ query: "needle", scope: "notes", limit: 10 }) as never,
            { host },
        );
        expect(firstResult.ok).toBe(true);
        const first = firstResult.content as VaultSnippetSearchOutput;
        expect(first.matches.length).toBeGreaterThan(0);
        expect(first.matches.length).toBeLessThan(10);
        expect(first.page.outputBudgetExceeded).toBe(true);
        expect(JSON.stringify(first).length).toBeLessThanOrEqual(6000);
        expect(firstResult.sources?.map(source => source.path)).toEqual(first.matches.map(match => match.path));
        expect(first.nextCursor).toBeTruthy();

        const secondResult = await searchTool.execute(
            searchTool.validateInput({
                query: "needle",
                scope: "notes",
                limit: 10,
                cursor: first.nextCursor,
            }) as never,
            { host },
        );
        const second = secondResult.content as VaultSnippetSearchOutput;
        expect(second.matches.map(match => match.path)).not.toContain(first.matches[0]!.path);
        expect(secondResult.sources?.map(source => source.path)).toEqual(second.matches.map(match => match.path));
        expect(second.nextCursor).toBeUndefined();
    });

    it("fails when metadata and the first match cannot fit and fails registry results above the declared budget", async () => {
        const escapedStem = "\"".repeat(950);
        const longPath = `notes/${escapedStem}.md`;
        const { host } = createHost({
            markdownFiles: [{ path: longPath, basename: escapedStem }],
            fileContents: { [longPath]: "needle" },
        });
        const result = await searchTool.execute(
            searchTool.validateInput({ query: "needle", scope: longPath }) as never,
            { host },
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain("cannot fit");
        expect(result.content).toBeNull();

        const definition = searchTool as unknown as ChatToolRegistryDefinition;
        const oversized = {
            ok: true,
            tool: "search_vault_snippets",
            inputSummary: "needle",
            content: {
                kind: "vault-snippets",
                query: "needle",
                part: "all",
                caseSensitive: false,
                matches: [{ path: "x".repeat(7000) }],
                matchCount: 1,
                matchCountKind: "exact",
                page: { startIndex: 0, returnedCount: 1, requestedLimit: 5, hasMore: false },
                coverage: { state: "complete" },
            },
            sources: [],
        } as never;
        expect(() => enforceToolOutputBudget(definition, oversized))
            .toThrow("search_vault_snippets result exceeds its output budget");
    });

    it("skips an actually oversized read without hashing or repartitioning truncated YAML", async () => {
        const path = "notes/oversized.md";
        const content = `---\nneedle: ${"x".repeat(100_100)}\n---`;
        const file = {
            path,
            basename: "oversized",
            stat: { mtime: 5, size: 10 },
        };
        const cachedRead = jest.fn(async () => content);
        const host = {
            app: {
                vault: {
                    getMarkdownFiles: () => [file],
                    getAbstractFileByPath: (requestedPath: string) => requestedPath === path ? file : null,
                    cachedRead,
                },
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;
        const hashMock = computeContentHash as jest.Mock;
        const callCountBefore = hashMock.mock.calls.length;

        const result = await execute(host, { query: "needle", part: "body", scope: path });

        expect(result.matches).toEqual([]);
        expect(result.nextCursor).toBeUndefined();
        expect(result.coverage).toMatchObject({
            state: "partial",
            readNotes: 1,
            readBytes: Buffer.byteLength(content, "utf8"),
            evaluatedBytes: 0,
            skippedFiles: 1,
            byteCapExceeded: true,
        });
        expect(result.skippedSources).toContain("vault file read skipped for size");
        expect(hashMock.mock.calls.slice(callCountBefore))
            .not.toContainEqual([content]);

        const complete = "---\nstatus: needle\n---\nbody";
        const completePath = "notes/complete.md";
        const completeHost = createHost({
            markdownFiles: [{ path: completePath, basename: "complete" }],
            fileContents: { [completePath]: complete },
        }).host;
        const properties = await execute(completeHost, { query: "needle", part: "properties", scope: completePath });
        expect(properties.matches[0]?.range).toMatchObject({ startOffset: 12, endOffset: 18 });
    });

    it("validates a filtered cachedRead API and its string result at call time", async () => {
        const baseVault = () => {
            const files = [{ path: "notes/a.md", basename: "a", stat: { mtime: 1, size: 6 } }];
            return {
                files,
                getMarkdownFiles: () => files,
            getAbstractFileByPath: (path: string) => path === "notes/a.md"
                    ? files[0]
                    : null,
            };
        };
        const disappearingVault: Record<string, unknown> = {
            ...baseVault(),
            cachedRead: async () => "needle",
        };
        const disappearingHost = {
            app: {
                vault: disappearingVault,
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;
        (computeContentHash as jest.Mock).mockImplementationOnce(async (input: unknown) => {
            delete disappearingVault.cachedRead;
            const { createHash } = jest.requireActual("node:crypto") as typeof import("node:crypto");
            return createHash("sha1").update(input as string, "utf8").digest("hex");
        });
        const disappearing = await createSearchVaultSnippetsTool({ isPathAllowed: () => true }).execute(
            { query: "needle" } as never,
            { host: disappearingHost },
        );
        expect(disappearing.ok).toBe(false);
        expect(disappearing.error).toContain("cachedRead is unavailable");

        const nonStringHost = {
            app: {
                vault: {
                    ...baseVault(),
                    cachedRead: async () => undefined as unknown as string,
                },
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;
        const nonString = await createSearchVaultSnippetsTool({ isPathAllowed: () => true }).execute(
            { query: "needle" } as never,
            { host: nonStringHost },
        );
        expect(nonString.ok).toBe(false);
        expect(nonString.error).toContain("did not return a string");

        const emptyHost = {
            app: {
                vault: {
                    ...baseVault(),
                    cachedRead: async () => "",
                },
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;
        const emptyResult = await createSearchVaultSnippetsTool({ isPathAllowed: () => true }).execute(
            { query: "needle" } as never,
            { host: emptyHost },
        );
        expect(emptyResult.ok).toBe(true);
        expect(emptyResult.content).toMatchObject({ matchCount: 0, matchCountKind: "exact" });

        const missingHost = {
            app: {
                vault: baseVault(),
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;
        const missing = await createSearchVaultSnippetsTool({ isPathAllowed: () => true }).execute(
            { query: "needle" } as never,
            { host: missingHost },
        );
        expect(missing.ok).toBe(true);
        expect(missing.content).toMatchObject({
            matchCount: 0,
            matchCountKind: "lower-bound",
            coverage: { state: "partial" },
            unavailableSources: ["vault file read"],
        });
    });

    it("preserves the source vault receiver in the path-filtered host", async () => {
        const file = { path: "notes/a.md", basename: "a", stat: { mtime: 1, size: 6 } };
        const vault = {
            contents: { "notes/a.md": "needle" } as Record<string, string>,
            getMarkdownFiles: () => [file],
            getAbstractFileByPath: (path: string) => path === file.path ? file : null,
            cachedRead(readFile: { path: string }) {
                return Promise.resolve(this.contents[readFile.path] ?? "");
            },
        };
        const host = {
            app: {
                vault,
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;

        const tool = createSearchVaultSnippetsTool({ isPathAllowed: () => true });
        const result = await tool.execute(
            tool.validateInput({ query: "needle" }),
            { host },
        );

        expect(result.ok).toBe(true);
        expect(result.content).toMatchObject({
            matchCount: 1,
            coverage: { state: "complete" },
        });
        expect(result.sources).toEqual([{ path: "notes/a.md" }]);
    });

    it("stops further physical reads once actual bytes exceed the total scan budget", async () => {
        const content = `${"x".repeat(100_100)}\nneedle`;
        const files = [0, 1, 2, 3].map(index => ({
            path: `notes/actual-${index}.md`,
            basename: `actual-${index}`,
            stat: { mtime: index + 1, size: 10 },
        }));
        const cachedRead = jest.fn(async (file: VaultFile) => content);
        const host = {
            app: {
                vault: {
                    getMarkdownFiles: () => files,
                    getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
                    cachedRead,
                },
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as never;

        const result = await execute(host, { query: "needle", scope: "notes" });

        expect(cachedRead).toHaveBeenCalledTimes(2);
        expect(result.coverage).toMatchObject({
            state: "partial",
            readNotes: 2,
            readBytes: Buffer.byteLength(content, "utf8") * 2,
            evaluatedBytes: 0,
            skippedFiles: 4,
            byteCapExceeded: true,
        });
        expect(result.nextCursor).toBeUndefined();
    });
});

function hostWithFile(file: Partial<VaultFile> & { path?: string }) {
    const path = file.path ?? "notes/a.md";
    const content = "needle";
    return createHost({
        markdownFiles: [{
            path,
            basename: "a",
            ...(file.stat === undefined ? {} : { stat: file.stat }),
        }],
        fileContents: { [path]: content },
        preserveMissingStat: true,
    }).host;
}
