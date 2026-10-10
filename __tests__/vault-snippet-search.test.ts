import { describe, expect, it, jest } from "@jest/globals";

import {
    createSearchVaultSnippetsTool,
    type VaultSnippetSearchOutput,
} from "../src/ai-services/chat-tools";
import { enforceToolOutputBudget } from "../src/ai-services/chat-tool-registry";
import { chatToolResultToPaAgentToolExecutionResult } from "../src/ai-services/pa-agent-host-tools";
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
    it("returns one lightweight note result for every permitted file without scan paging", async () => {
        const fileCount = 100;
        const fileContents = Object.fromEntries(Array.from({ length: fileCount }, (_, index) => [
            `notes/${String(index).padStart(3, "0")}.md`,
            index === 0 ? "needle first\nneedle repeated" : index === 1 ? "no match" : "needle",
        ]));
        const files = Object.keys(fileContents).map(path => ({ path, basename: path.slice(0, -3) }));
        const { host, cachedRead } = createHost({ markdownFiles: files, fileContents });

        const result = await execute(host, { query: "needle" });

        expect(result.matchCount).toBe(99);
        expect(result.matches).toHaveLength(99);
        expect(result.matches.map(match => match.path).slice(0, 3)).toEqual([
            "notes/000.md",
            "notes/002.md",
            "notes/003.md",
        ]);
        expect(new Set(result.matches.map(match => match.path)).size).toBe(99);
        expect(result.matches[0]).not.toHaveProperty("snippet");
        expect(Object.prototype.hasOwnProperty.call(result, "nextCursor")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(result, "page")).toBe(false);
        expect(result.matchCountKind).toBe("exact");
        expect(result.coverage).toMatchObject({
            state: "complete",
            scannedPermittedNotes: 100,
            readNotes: 100,
        });
        expect(cachedRead).toHaveBeenCalledTimes(100);

        const limited = await execute(host, { query: "needle", limit: 5 });
        expect(limited.matchCount).toBe(99);
        expect(limited.matches).toHaveLength(5);
        expect(cachedRead).toHaveBeenCalledTimes(200);
    });

    it("checks each read file directly without enumerating the vault again", async () => {
        const fileContents = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`notes/${index}.md`, "needle"]));
        const f = createHost({ markdownFiles: Object.keys(fileContents).map(path => ({ path })), fileContents });
        const vault = (f.host as unknown as { app: { vault: { getMarkdownFiles: () => VaultFile[] } } }).app.vault;
        const enumerate = jest.fn(vault.getMarkdownFiles);
        vault.getMarkdownFiles = enumerate;

        const result = await execute(f.host, { query: "needle", limit: 20 });

        expect(result.matchCount).toBe(12);
        expect(f.cachedRead).toHaveBeenCalledTimes(12);
        // Initial candidate snapshot and two whole-source-set checks, independent of body read count.
        expect(enumerate).toHaveBeenCalledTimes(3);
    });

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

    it("returns repeated matches in one note once at the first location", async () => {
        const content = "needle alpha\nmiddle\nneedle beta";
        const files = [{ path: "notes/multi.md", basename: "multi", stat: { mtime: 2, size: Buffer.byteLength(content) } }];
        const fileContents: Record<string, string> = { "notes/multi.md": content };
        const { host, cachedRead } = createHost({ markdownFiles: files, fileContents });

        const result = await execute(host, { query: "needle", scope: "notes/multi.md" });
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]?.range.startOffset).toBe(0);
        expect(result.matches[0]).not.toHaveProperty("snippet");
        expect(Object.prototype.hasOwnProperty.call(result, "page")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(result, "nextCursor")).toBe(false);
        expect(cachedRead).toHaveBeenCalledTimes(1);
        expect(result.coverage).toMatchObject({ state: "complete", readNotes: 1 });
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

    it("rejects retired cursors before execution", () => {
        expect(() => searchTool.validateInput({ query: "needle", cursor: "legacy" }))
            .toThrow("rerun the same complete query without cursor");
    });

    it("marks an actually unknown size partial while a large readable note is searchable", async () => {
        const unknownSize = await execute(hostWithFile({ stat: undefined }), {
            query: "needle",
            scope: "notes/a.md",
        });
        expect(unknownSize.matches).toEqual([]);
        expect(unknownSize.coverage).toMatchObject({ state: "partial", unknownFileSize: true });
        expect(unknownSize.unavailableSources).toContain("vault file stat unavailable");

        const oversized = await execute(hostWithFile({
            stat: { mtime: 1, size: 100_001 },
        }), { query: "needle", scope: "notes/a.md" });
        expect(oversized.matches).toHaveLength(1);
        expect(oversized.coverage).toMatchObject({ state: "complete", readNotes: 1 });
        expect(Buffer.byteLength("needle", "utf8")).toBeLessThan(100_001);
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

    it.each([
        ["added", (files: VaultFile[], replacement: VaultFile) => { files.push(replacement); }],
        ["removed", (files: VaultFile[], _replacement: VaultFile) => { files.splice(1, 1); }],
        ["replaced", (files: VaultFile[], _replacement: VaultFile) => {
            files[1] = { ...files[1]! };
        }],
    ] as const)("rejects a source set with a %s file while reading the final fixtures", async (_kind, mutate) => {
        const files = ["a", "b", "c"].map(name => ({
            path: `notes/${name}.md`,
            basename: name,
            stat: { mtime: name.charCodeAt(0), size: 9 },
        }));
        const replacement = {
            path: "notes/d.md",
            basename: "d",
            stat: { mtime: 4, size: 9 },
        };
        const fileContents = Object.fromEntries(files.map(file => [file.path, "needle"]));
        const cachedRead = jest.fn(async (file: VaultFile) => {
            if (file.path === "notes/b.md") mutate(files, replacement);
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
        expect(result.error ?? "").toMatch(/sources changed|permitted note集合 changed/i);
    });

    it("stops an in-flight snippet search at a real read checkpoint when the call is aborted", async () => {
        const files = ["a", "b"].map(name => ({
            path: `notes/${name}.md`,
            basename: name,
            stat: { mtime: name.charCodeAt(0), size: 9 },
        }));
        const controller = new AbortController();
        const cachedRead = jest.fn(async (file: VaultFile) => {
            controller.abort();
            return file.path === "notes/a.md" ? "needle" : "no match";
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

        const error = await searchTool.execute(
            searchTool.validateInput({ query: "needle", scope: "notes" }) as never,
            { host, signal: controller.signal },
        ).then(() => undefined, caught => caught as Error);

        expect(error?.name).toBe("AbortError");
        expect(cachedRead).toHaveBeenCalledTimes(1);
    });

    it("searches every candidate beyond the old candidate cap", async () => {
        const files = Array.from({ length: 401 }, (_, index) => ({
            path: `notes/candidate-${String(index).padStart(3, "0")}.md`,
            basename: `candidate-${index}`,
            stat: { mtime: index + 1, size: 0 },
        }));
        const cachedRead = jest.fn(async () => "");
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

        expect(result.coverage).toMatchObject({
            state: "complete",
            scannedPermittedNotes: 401,
            evaluatedCandidates: 401,
            readNotes: 401,
        });
        expect(cachedRead).toHaveBeenCalledTimes(401);
    });

    it("keeps every visible source in one complete provider result", async () => {
        const files = Array.from({ length: 10 }, (_, index) => ({
            path: `notes/${"long-".repeat(80)}-${index}.md`,
            basename: `long-${index}`,
        }));
        const fileContents = Object.fromEntries(files.map(file => [file.path, `needle ${"x".repeat(250)}`]));
        const { host } = createHost({ markdownFiles: files, fileContents });

        const completeResult = await searchTool.execute(
            searchTool.validateInput({ query: "needle", scope: "notes", limit: 10 }) as never,
            { host },
        );
        expect(completeResult.ok).toBe(true);
        const complete = completeResult.content as VaultSnippetSearchOutput;
        expect(complete.matches).toHaveLength(10);
        expect(Object.prototype.hasOwnProperty.call(complete, "page")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(complete, "nextCursor")).toBe(false);
        expect(JSON.stringify(complete).length).toBeGreaterThan(6_000);
        expect(completeResult.sources?.map(source => source.path))
            .toEqual(complete.matches.map(match => match.path));
    });

    it("returns and projects a result larger than the old output budget", async () => {
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
        expect(result.ok).toBe(true);
        expect(result.content?.matches[0]?.path).toBe(longPath);
        expect(JSON.stringify(result.content).length).toBeGreaterThan(6_000);

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
                coverage: { state: "complete" },
            },
            sources: [],
        } as never;
        expect(enforceToolOutputBudget(definition, oversized)).toBe(oversized);

        const projected = chatToolResultToPaAgentToolExecutionResult({
            type: "toolCall",
            index: 0,
            id: "complete-snippets",
            name: "search_vault_snippets",
            input: { query: "needle", scope: longPath },
        }, result);
        const projectedObservation = (JSON.parse(projected.promptText) as {
            observation: VaultSnippetSearchOutput;
        }).observation;
        expect(projectedObservation.matches[0]?.path).toBe(longPath);
        expect(projected.promptText.length).toBeGreaterThan(JSON.stringify(result.content).length);
    });

    it("searches a note larger than the old per-file byte cap", async () => {
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
        const result = await execute(host, { query: "needle", part: "body", scope: path });

        expect(result.matches).toEqual([]);
        expect(result.coverage).toMatchObject({
            state: "complete",
            readNotes: 1,
            readBytes: Buffer.byteLength(content, "utf8"),
            evaluatedBytes: Buffer.byteLength(content, "utf8"),
        });
        expect(Buffer.byteLength(content, "utf8")).toBeGreaterThan(100_000);

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
            const files = [
                { path: "notes/a.md", basename: "a", stat: { mtime: 1, size: 6 } },
                { path: "notes/b.md", basename: "b", stat: { mtime: 2, size: 6 } },
            ];
            return {
                files,
                getMarkdownFiles: () => files,
            getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
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
        const disappearingHash = computeContentHash as jest.Mock;
        const originalDisappearingHash = disappearingHash.getMockImplementation();
        const fallbackDigest = async (input: unknown) => {
            const { createHash } = jest.requireActual("node:crypto") as typeof import("node:crypto");
            return createHash("sha1").update(String(input), "utf8").digest("hex");
        };
        disappearingHash.mockImplementation(async (input: unknown) => {
            if (String(input) === "needle") delete disappearingVault.cachedRead;
            return fallbackDigest(input);
        });
        let disappearing: Awaited<ReturnType<typeof searchTool.execute>>;
        try {
            disappearing = await createSearchVaultSnippetsTool({ isPathAllowed: () => true }).execute(
                { query: "needle" } as never,
                { host: disappearingHost },
            );
        } finally {
            disappearingHash.mockImplementation(originalDisappearingHash ?? fallbackDigest);
        }
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
        expect(emptyResult.resultFact).toMatchObject({ kind: "no_match", search: "snippet",
            observationId: expect.any(String) });

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
        expect(missing.resultFact?.kind).not.toBe("no_match");
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

    it("keeps reading when actual bytes exceed the old aggregate scan budget", async () => {
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

        expect(cachedRead).toHaveBeenCalledTimes(4);
        expect(result.coverage).toMatchObject({
            state: "complete",
            readNotes: 4,
            readBytes: Buffer.byteLength(content, "utf8") * 4,
            evaluatedBytes: Buffer.byteLength(content, "utf8") * 4,
        });
        expect(result.matches).toHaveLength(4);
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
