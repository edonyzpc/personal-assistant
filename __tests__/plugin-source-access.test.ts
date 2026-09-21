import { describe, expect, it, jest } from "@jest/globals";
import type { TAbstractFile } from "obsidian";
import { TFile } from "obsidian";

import { SourceAccess, buildMemoryDataBoundaryFingerprint } from "../src/plugin/source-access";
import type { DataBoundarySettings } from "../src/settings";
import type { PageletSettings } from "../src/settings/pagelet";

jest.mock("obsidian", () => {
    class MockTFile {
        path: string;
        extension: string;
        constructor(path: string) {
            this.path = path;
            this.extension = path.includes(".") ? path.split(".").pop() ?? "" : "";
        }
    }
    return {
        TFile: MockTFile,
        normalizePath: (path: string) => path,
        getFrontMatterInfo: (markdown: string) => {
            const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
            if (!match) return { exists: false, contentStart: 0, frontmatter: "", from: 0, to: 0 };
            return {
                exists: true,
                contentStart: match[0].length,
                frontmatter: match[1] ?? "",
                from: 4,
                to: 4 + (match[1]?.length ?? 0),
            };
        },
        parseYaml: (yaml: string) => {
            if (yaml.includes("pa_writing") && yaml.includes("origin: ai_generated")) {
                return { pa_writing: { version: 1, origin: "ai_generated" } };
            }
            if (yaml.includes("[")) throw new Error("yaml arrays intentionally unsupported in fixture");
            return Object.fromEntries(yaml.split(/\r?\n/).map((line) => {
                const match = /^([^:]+):\s*(.*)$/.exec(line);
                if (!match) throw new Error("malformed yaml");
                const value = match[2]!.trim();
                return [match[1]!.trim(), value === "true" ? true : value];
            }));
        },
    };
});

type FakeFile = TFile & { stat: { ctime: number; mtime: number; size: number } };

const createFile = (path: string, stat = { mtime: 10, size: 20 }): FakeFile => {
    const FileCtor = TFile as unknown as { new(path: string): FakeFile };
    const file = new FileCtor(path);
    file.stat = { ctime: stat.mtime, ...stat };
    return file;
};

const dataBoundary = (overrides: Partial<DataBoundarySettings> = {}): DataBoundarySettings => ({
    excludedFolders: [],
    excludedTags: [],
    generatedNotePolicy: "exclude-generated" as const,
    providerDisclosureReasons: ["first_use"],
    cleanupGroups: ["cache"],
    ...overrides,
});

const pagelet = (overrides: Record<string, unknown> = {}) => ({
    excludedFolders: [],
    excludedTags: [],
    excludedPatterns: [],
    reviewsFolder: ".pagelet",
    ...overrides,
});

const createOwner = (
    files: FakeFile[],
    options: {
        dataBoundary?: ReturnType<typeof dataBoundary>;
        memoryExcludePrefixes?: string[];
        pagelet?: ReturnType<typeof pagelet>;
        metadata?: Record<string, unknown>;
        read?: (file: FakeFile) => Promise<string>;
        lookup?: (path: string) => TAbstractFile | null;
    } = {},
) => {
    const settings = {
        dataBoundary: options.dataBoundary ?? dataBoundary(),
        memoryExcludePrefixes: options.memoryExcludePrefixes ?? [],
            pagelet: (options.pagelet ?? pagelet()) as unknown as PageletSettings,
    };
    const app = {
        vault: {
            getMarkdownFiles: () => files,
            getAbstractFileByPath: (path: string): TAbstractFile | null =>
                options.lookup?.(path) ?? files.find((file) => file.path === path) ?? null,
            read: options.read ?? (async (file: FakeFile) => `body:${file.path}`),
        },
        metadataCache: {
            getFileCache: (file: FakeFile) => options.metadata?.[file.path] ?? null,
            resolvedLinks: {},
        },
    };
    const log = jest.fn();
    return { owner: new SourceAccess({ app, getSettings: () => settings, log }), settings, app, log };
};

describe("SourceAccess", () => {
    it("keeps the Memory prefix exclusion and shared Data Boundary as a union", () => {
        const keep = createFile("notes/keep.md");
        const memoryPrivate = createFile("memory/private.md");
        const sharedPrivate = createFile("shared/private.md");
        const { owner } = createOwner([keep, memoryPrivate, sharedPrivate], {
            memoryExcludePrefixes: ["memory/"],
            dataBoundary: dataBoundary({ excludedFolders: ["shared"] }),
        });

        expect(owner.getVSSFiles()).toEqual([keep]);
        expect(owner.isMemoryProviderPathAllowed("notes/keep.md")).toBe(true);
        expect(owner.isMemoryProviderPathAllowed("memory/private.md")).toBe(false);
        expect(owner.isMemoryProviderPathAllowed("shared/private.md")).toBe(false);
    });

    it("requires the intersection of Memory and Pagelet admission for Pagelet sources", () => {
        const keep = createFile("notes/keep.md", { mtime: 1, size: 10 });
        const pageletPrivate = createFile("pagelet-local/private.md", { mtime: 2, size: 20 });
        const { owner } = createOwner([keep, pageletPrivate], {
            pagelet: pagelet({ excludedFolders: ["pagelet-local"] }),
        });

        expect(owner.isPageletProviderPathAllowed(keep.path)).toBe(true);
        expect(owner.isPageletProviderPathAllowed(pageletPrivate.path)).toBe(false);
        expect(owner.isMemoryProviderPathAllowed(pageletPrivate.path)).toBe(true);
    });

    it("fails closed for deny and ask Data Boundary decisions", () => {
        const folderDenied = createFile("private/note.md");
        const generatedAsk = createFile("notes/generated.md");
        const { owner } = createOwner([folderDenied, generatedAsk], {
            dataBoundary: dataBoundary({
                excludedFolders: ["private"],
                generatedNotePolicy: "ask",
            }),
            metadata: { "notes/generated.md": { frontmatter: { pagelet: true } } },
        });

        expect(owner.decideDataBoundaryForPath(folderDenied.path)).toMatchObject({
            decision: "deny",
            reason: "excluded_folder",
        });
        expect(owner.decideDataBoundaryForPath(generatedAsk.path)).toMatchObject({
            decision: "ask",
            reason: "generated_note",
        });
        expect(owner.isDataBoundaryAllowedFile(folderDenied)).toBe(false);
        expect(owner.isDataBoundaryAllowedFile(generatedAsk)).toBe(false);
    });

    it("rejects stale file identity after a stable source read", async () => {
        const original = createFile("notes/stale.md", { mtime: 1, size: 10 });
        const replacement = createFile("notes/stale.md", { mtime: 2, size: 20 });
        let current = original;
        const { owner } = createOwner([original], {
            lookup: (path) => path === replacement.path ? current : null,
            read: async () => {
                current = replacement;
                return "safe body";
            },
        });

        await expect(owner.captureLatestMemorySource(
            original.path,
            (path) => owner.isMemoryProviderPathAllowed(path),
            "chat",
        )).resolves.toBeNull();
    });

    it("rechecks exact body tags and malformed leading frontmatter", async () => {
        const file = createFile("notes/body.md");
        const { owner } = createOwner([file], {
            dataBoundary: dataBoundary({ excludedTags: ["sensitive"] }),
        });

        expect(owner.isVSSFileEligible(file, "# Heading\n\n#sensitive")).toBe(false);
        expect(owner.isVSSFileEligible(file, "# Heading\n\n```md\n#sensitive\n```")).toBe(true);
        expect(owner.isVSSFileEligible(file, "---\ntags: sensitive\n---\nbody")).toBe(false);
        expect(owner.isVSSFileEligible(file, "---\ntags: sensitive\nprivate body")).toBe(false);
    });

    it("recognizes generated Pagelet and writing provenance before provider reads", () => {
        const pageletGenerated = createFile("notes/generated.md");
        const writingGenerated = createFile("notes/writing.md");
        const { owner } = createOwner([pageletGenerated, writingGenerated], {
            metadata: {
                "notes/generated.md": { frontmatter: { pagelet: "true" } },
                "notes/writing.md": { frontmatter: { pa_writing: { version: 1, origin: "ai_generated" } } },
            },
        });

        expect(owner.isGeneratedDataBoundaryFile(pageletGenerated)).toBe(true);
        expect(owner.isGeneratedDataBoundaryFile(writingGenerated)).toBe(true);
        expect(owner.getLatestDataBoundaryContentBoundary(
            pageletGenerated.path,
            "---\npagelet: true\n---\nbody",
        )).toMatchObject({ allowed: false, isGenerated: true });
        expect(owner.getLatestPageletContentBoundary(
            writingGenerated.path,
            "---\npa_writing:\n  version: 1\n  origin: ai_generated\n---\nbody",
        )).toMatchObject({ allowed: false, isGenerated: true });
    });

    it("returns a successful stable read only after exact-body admission", async () => {
        const file = createFile("notes/current.md", { mtime: 10, size: 20 });
        const { owner } = createOwner([file]);

        await expect(owner.captureLatestMemorySource(
            file.path,
            (path) => owner.isMemoryProviderPathAllowed(path),
            "chat",
        )).resolves.toEqual({
            path: file.path,
            markdown: `body:${file.path}`,
            mtime: 10,
            size: 20,
        });
    });

    it("rejects a source whose permission is revoked during the read", async () => {
        const file = createFile("notes/revoked.md");
        let allowed = true;
        const { owner } = createOwner([file], {
            read: async () => {
                allowed = false;
                return "formerly allowed body";
            },
        });

        await expect(owner.captureLatestMemorySource(
            file.path,
            () => allowed,
            "chat",
        )).resolves.toBeNull();
    });

    it("keeps AbortError and fails non-abort reads closed without caching", async () => {
        const file = createFile("notes/current.md");
        const controller = new AbortController();
        const { owner } = createOwner([file], {
            read: async () => {
                controller.abort();
                return "late";
            },
        });

        await expect(owner.captureLatestMemorySource(
            file.path,
            () => true,
            "chat",
            controller.signal,
        )).rejects.toMatchObject({ name: "AbortError" });

        const failing = createOwner([file], {
            read: async () => {
                throw new Error("disk unavailable");
            },
        });
        await expect(failing.owner.captureLatestMemorySource(file.path, () => true, "chat"))
            .resolves.toBeNull();
        expect(failing.log).toHaveBeenCalledWith(
            "Latest Memory source read failed closed",
            { errorType: "Error" },
        );
    });

    it("classifies graph nodes as allowed, transient opaque, or blocked", () => {
        const allowed = createFile("notes/allowed.md");
        const ordinaryExcluded = createFile("private/bridge.md");
        const generated = createFile(".pagelet/generated.md");
        const image = createFile("assets/image.png");
        const { owner, app } = createOwner([allowed, ordinaryExcluded, generated, image], {
            memoryExcludePrefixes: ["private"],
            metadata: { ".pagelet/generated.md": { frontmatter: { pagelet: true } } },
        });
        app.metadataCache.resolvedLinks = {
            "notes/allowed.md": {
                "private/bridge.md": 1,
                ".pagelet/generated.md": 1,
                "assets/image.png": 1,
            },
        };

        expect(owner.classifyMemoryGraphPath("notes/allowed.md", "chat")).toBe("allowed_markdown");
        expect(owner.classifyMemoryGraphPath("private/bridge.md", "chat")).toBe("opaque_excluded_markdown");
        expect(owner.classifyMemoryGraphPath(".pagelet/generated.md", "chat")).toBe("blocked");
        expect(owner.classifyMemoryGraphPath("assets/image.png", "chat")).toBe("blocked");
    });

    it("changes graph epochs on invalidation and exact Memory-prefix policy changes", () => {
        const { owner, settings } = createOwner([]);
        const before = owner.getMemoryGraphTopologyEpoch("chat");

        settings.memoryExcludePrefixes = ["private"];
        const policyChanged = owner.getMemoryGraphTopologyEpoch("chat");
        expect(policyChanged).not.toBe(before);

        owner.invalidateMemoryGraphTopology();
        expect(owner.getMemoryGraphTopologyEpoch("chat")).not.toBe(policyChanged);
    });

    it("builds a canonical fingerprint from the full persisted policy", () => {
        const first = dataBoundary({
            excludedFolders: [" private ", ".pagelet", ""],
            excludedTags: ["#Secret", "#Health"],
            providerDisclosureReasons: ["memory_preparation", "memory_search"] as unknown as DataBoundarySettings["providerDisclosureReasons"],
            cleanupGroups: ["cache", "queue"],
        });
        const reordered = dataBoundary({
            cleanupGroups: ["queue", "cache"],
            providerDisclosureReasons: ["memory_search", "memory_preparation"] as unknown as DataBoundarySettings["providerDisclosureReasons"],
            excludedTags: ["health", "secret"],
            excludedFolders: [".pagelet", "private"],
        });

        expect(buildMemoryDataBoundaryFingerprint(first)).toBe(buildMemoryDataBoundaryFingerprint(reordered));
        expect(buildMemoryDataBoundaryFingerprint(first)).toBe("data_boundary:ca308396");
    });
});
