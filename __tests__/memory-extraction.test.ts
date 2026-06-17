import { describe, expect, it, jest } from "@jest/globals";

import {
    MemoryExtractionScheduler,
    MemoryUserProfileStore,
    TypeAUserProfileExtractor,
    TypeCVaultMetacognitionAnalyzer,
} from "../src/ai-services/memory-extraction";

describe("TypeAUserProfileExtractor", () => {
    it("extracts explicit preferences and renders confirmed profile markdown", () => {
        const extractor = new TypeAUserProfileExtractor();
        const candidates = extractor.extractCandidates({
            conversation: {
                id: "c1",
                title: "Prefs",
                createdAt: "2026-06-16T00:00:00.000Z",
                updatedAt: "2026-06-16T00:00:00.000Z",
                turnCount: 1,
                preview: "Remember",
            },
            turns: [{
                conversationId: "c1",
                turnIndex: 1,
                user: { role: "user", content: "Remember I prefer concise Conventional Commits." },
                assistant: { role: "assistant", content: "Noted." },
            }],
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });
        const snapshot = extractor.mergeCandidates(null, candidates, new Date("2026-06-16T08:00:00.000Z"));

        expect(candidates).toHaveLength(1);
        expect(snapshot.records[0].confirmed).toBe(true);
        expect(snapshot.markdown).toContain("# User Profile");
        expect(snapshot.markdown).toContain("Remember I prefer concise Conventional Commits.");
    });
});

describe("MemoryExtractionScheduler", () => {
    it("loads and persists Type A profile snapshots through the provided store", async () => {
        const userProfileStore = new MemoryUserProfileStore();
        const chatHistoryManager = {
            findConversation: jest.fn(async () => ({
                id: "c1",
                title: "Prefs",
                createdAt: "2026-06-16T00:00:00.000Z",
                updatedAt: "2026-06-16T00:00:00.000Z",
                turnCount: 1,
                preview: "Remember",
            })),
            getTurns: jest.fn(async () => [{
                conversationId: "c1",
                turnIndex: 1,
                user: { role: "user", content: "记住，我偏好中文优先的用户文档。" },
                assistant: { role: "assistant", content: "好的。" },
            }]),
        };
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: chatHistoryManager as any,
            userProfileStore,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        const snapshot = await scheduler.runTypeAExtraction("c1");
        const persisted = await userProfileStore.getProfile();

        expect(snapshot?.markdown).toContain("我偏好中文优先的用户文档");
        expect(persisted?.markdown).toBe(snapshot?.markdown);
        expect(scheduler.getPromptContext().userProfile).toContain("# User Profile");
    });

    it("processes only new Type A turns for a conversation", async () => {
        const userProfileStore = new MemoryUserProfileStore();
        const turns = [
            {
                conversationId: "c1",
                turnIndex: 1,
                user: { role: "user" as const, content: "Remember I prefer short answers." },
                assistant: { role: "assistant" as const, content: "Noted." },
            },
        ];
        const chatHistoryManager = {
            findConversation: jest.fn(async () => ({
                id: "c1",
                title: "Prefs",
                createdAt: "2026-06-16T00:00:00.000Z",
                updatedAt: "2026-06-16T00:00:00.000Z",
                turnCount: turns.length,
                preview: "Remember",
            })),
            getTurns: jest.fn(async () => turns),
        };
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: chatHistoryManager as any,
            userProfileStore,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        await scheduler.runTypeAExtraction("c1");
        await scheduler.runTypeAExtraction("c1");
        turns.push({
            conversationId: "c1",
            turnIndex: 2,
            user: { role: "user" as const, content: "Remember I prefer Chinese docs first." },
            assistant: { role: "assistant" as const, content: "Noted." },
        });
        const snapshot = await scheduler.runTypeAExtraction("c1");

        expect(snapshot?.records).toHaveLength(2);
        expect(snapshot?.records.map((record) => record.text)).toEqual([
            "Remember I prefer short answers.",
            "Remember I prefer Chinese docs first.",
        ]);
    });

    it("keeps Type C internal by default and does not inject vault insights into prompts", async () => {
        const write = jest.fn();
        const app = {
            vault: {
                getMarkdownFiles: () => [],
                adapter: {
                    exists: jest.fn(async () => false),
                    mkdir: jest.fn(async () => undefined),
                    write,
                },
            },
            metadataCache: {
                getFileCache: jest.fn(),
                resolvedLinks: {},
                unresolvedLinks: {},
            },
        };
        const scheduler = new MemoryExtractionScheduler({
            app: app as any,
            chatHistoryManager: {
                findConversation: jest.fn(),
                getTurns: jest.fn(),
            } as any,
            userProfileStore: new MemoryUserProfileStore(),
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        await scheduler.runTypeCRefresh("test");

        expect(write).not.toHaveBeenCalled();
        expect(scheduler.getPromptContext().vaultInsights).toBeUndefined();
    });
});

describe("TypeCVaultMetacognitionAnalyzer", () => {
    it("summarizes folder themes, tags, link topology, and unresolved-link gaps", () => {
        const now = new Date("2026-06-16T08:00:00.000Z").getTime();
        const files = [
            { path: "Projects/AI.md", stat: { mtime: now, ctime: now, size: 1200 } },
            { path: "Projects/Memory.md", stat: { mtime: now - 1000, ctime: now - 1000, size: 600 } },
            { path: "Reading/Book.md", stat: { mtime: now - 2000, ctime: now - 2000, size: 300 } },
        ];
        const app = {
            vault: {
                getMarkdownFiles: () => files,
            },
            metadataCache: {
                getFileCache: (file: { path: string }) => {
                    if (file.path === "Projects/AI.md") {
                        return { tags: [{ tag: "#ai" }], frontmatter: { tags: ["memory"] } };
                    }
                    return { tags: [], frontmatter: {} };
                },
                resolvedLinks: {
                    "Projects/AI.md": { "Projects/Memory.md": 2 },
                    "Projects/Memory.md": { "Reading/Book.md": 1 },
                },
                unresolvedLinks: {
                    "Projects/AI.md": { "Missing Concept": 2 },
                },
            },
        };

        const analyzer = new TypeCVaultMetacognitionAnalyzer(app as any);
        const snapshot = analyzer.analyze(new Date(now));
        const markdown = analyzer.renderMarkdown(snapshot);

        expect(snapshot.fileCount).toBe(3);
        expect(snapshot.folderThemes[0]).toEqual({ folder: "Projects", count: 2 });
        expect(snapshot.tagTaxonomy).toEqual([
            { tag: "#ai", count: 1 },
            { tag: "#memory", count: 1 },
        ]);
        expect(snapshot.knowledgeGaps[0]).toEqual({
            label: "Missing Concept",
            evidence: "2 unresolved link reference(s) point here.",
        });
        expect(markdown).toContain("# Vault Insights");
        expect(markdown).toContain("## Link Topology");
        expect(markdown).toContain("Missing Concept");
    });
});
