import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
    MemoryExtractionScheduler,
    MemoryUserProfileStore,
    TypeAUserProfileExtractor,
    TypeCVaultMetacognitionAnalyzer,
    extractCandidatesFromText,
    renderUserProfileMarkdown,
} from "../src/ai-services/memory-extraction";
import type { UserProfileCandidate, UserProfileRecord } from "../src/ai-services/memory-extraction";

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

    it("extracts user_correction candidates from English correction phrases", () => {
        const candidates = extractCandidatesFromText(
            "I told you don't use bullet points",
            "c-corr-1",
            "2026-06-16T08:00:00.000Z",
        );
        expect(candidates.length).toBeGreaterThanOrEqual(1);
        expect(candidates.some((c) => c.kind === "user_correction")).toBe(true);
    });

    it("extracts user_correction candidates from CJK correction phrases", () => {
        const candidates = extractCandidatesFromText(
            "不要用列表格式",
            "c-corr-2",
            "2026-06-16T08:00:00.000Z",
        );
        expect(candidates.length).toBeGreaterThanOrEqual(1);
        expect(candidates.some((c) => c.kind === "user_correction")).toBe(true);
    });

    it("promotes tentative inferred_behavior records to confirmed after 3 independent conversations", () => {
        const extractor = new TypeAUserProfileExtractor();
        const makeCandidate = (conversationId: string): UserProfileCandidate => ({
            key: "prefer-dark-mode",
            text: "I prefer dark mode",
            kind: "inferred_behavior",
            confidence: "medium",
            conversationId,
            observedAt: "2026-06-16T08:00:00.000Z",
        });
        const now = new Date("2026-06-16T08:00:00.000Z");

        const snapshot1 = extractor.mergeCandidates(null, [makeCandidate("conv-1")], now);
        expect(snapshot1.records[0].confirmed).toBe(false);
        expect(snapshot1.records[0].occurrences).toBe(1);

        const snapshot2 = extractor.mergeCandidates(snapshot1, [makeCandidate("conv-2")], now);
        expect(snapshot2.records[0].confirmed).toBe(false);
        expect(snapshot2.records[0].occurrences).toBe(2);

        const snapshot3 = extractor.mergeCandidates(snapshot2, [makeCandidate("conv-3")], now);
        expect(snapshot3.records[0].confirmed).toBe(true);
        expect(snapshot3.records[0].occurrences).toBe(3);
    });

    it("truncates profile markdown to 1400 chars capacity limit", () => {
        const records: UserProfileRecord[] = Array.from({ length: 40 }, (_, i) => ({
            key: `pref-${i}`,
            text: `This is a long preference statement number ${i} that the user expressed explicitly in conversation to pad profile size.`,
            kind: "user_explicit" as const,
            confidence: "high" as const,
            conversationId: `c-cap-${i}`,
            observedAt: "2026-06-16T08:00:00.000Z",
            occurrences: 1,
            conversationIds: [`c-cap-${i}`],
            confirmed: true,
        }));
        const markdown = renderUserProfileMarkdown(records, new Date("2026-06-16T08:00:00.000Z"));
        expect(markdown.length).toBeLessThanOrEqual(1400);
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

describe("MemoryExtractionScheduler lifecycle", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("start() schedules a Type C refresh and dispose() cancels pending timers", () => {
        const getMarkdownFiles = jest.fn(() => []);
        const app = {
            vault: {
                getMarkdownFiles,
                adapter: {
                    exists: jest.fn(async () => false),
                    mkdir: jest.fn(async () => undefined),
                    write: jest.fn(),
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

        scheduler.start();
        // startup refresh is scheduled at 15s delay
        jest.advanceTimersByTime(15_000);
        expect(getMarkdownFiles).toHaveBeenCalled();

        const callCountAfterStart = getMarkdownFiles.mock.calls.length;
        scheduler.dispose();

        // Advance well past the interval; no new calls should happen
        jest.advanceTimersByTime(48 * 60 * 60_000);
        expect(getMarkdownFiles.mock.calls.length).toBe(callCountAfterStart);
    });

    it("dispose() can be called safely without prior start()", () => {
        const scheduler = new MemoryExtractionScheduler({
            app: { vault: { getMarkdownFiles: () => [] }, metadataCache: {} } as any,
            chatHistoryManager: { findConversation: jest.fn(), getTurns: jest.fn() } as any,
            userProfileStore: new MemoryUserProfileStore(),
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });
        expect(() => scheduler.dispose()).not.toThrow();
    });

    it("getPromptContext() returns empty after dispose without prior extraction", () => {
        const scheduler = new MemoryExtractionScheduler({
            app: { vault: { getMarkdownFiles: () => [] }, metadataCache: {} } as any,
            chatHistoryManager: { findConversation: jest.fn(), getTurns: jest.fn() } as any,
            userProfileStore: new MemoryUserProfileStore(),
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });
        scheduler.dispose();
        const ctx = scheduler.getPromptContext();
        expect(ctx.userProfile).toBeUndefined();
        expect(ctx.vaultInsights).toBeUndefined();
    });
});

describe("TypeCVaultMetacognitionAnalyzer", () => {
    it("summarizes folder themes, tags, link topology, and unresolved-link gaps", async () => {
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
        const snapshot = await analyzer.analyze(new Date(now));
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

    it("analyzes writingHabits with busiestWeekdays and averageWords", async () => {
        const now = new Date("2026-06-16T08:00:00.000Z"); // Tuesday
        const tuesday = now.getTime();
        const wednesday = tuesday + 24 * 60 * 60_000;
        const files = [
            { path: "Notes/A.md", stat: { mtime: tuesday, ctime: tuesday, size: 600 } },
            { path: "Notes/B.md", stat: { mtime: tuesday, ctime: tuesday, size: 1200 } },
            { path: "Notes/C.md", stat: { mtime: wednesday, ctime: wednesday, size: 900 } },
        ];
        const app = {
            vault: { getMarkdownFiles: () => files },
            metadataCache: {
                getFileCache: () => ({ tags: [], frontmatter: {} }),
                resolvedLinks: {},
                unresolvedLinks: {},
            },
        };
        const analyzer = new TypeCVaultMetacognitionAnalyzer(app as any);
        const snapshot = await analyzer.analyze(now);

        expect(snapshot.writingHabits.busiestWeekdays.length).toBeGreaterThan(0);
        const weekdayLabels = snapshot.writingHabits.busiestWeekdays.map((e) => e.weekday);
        expect(weekdayLabels.some((d) => d === "Tue")).toBe(true);
        expect(snapshot.writingHabits.averageWords).toBeGreaterThan(0);
    });

    it("analyzes trends dimension for files modified within last 30 days", async () => {
        const now = new Date("2026-06-16T08:00:00.000Z");
        const nowMs = now.getTime();
        const recentTime = nowMs - 5 * 24 * 60 * 60_000; // 5 days ago
        const oldTime = nowMs - 60 * 24 * 60 * 60_000; // 60 days ago
        const files = [
            { path: "Active/Today.md", stat: { mtime: nowMs, ctime: nowMs, size: 400 } },
            { path: "Active/Recent.md", stat: { mtime: recentTime, ctime: recentTime, size: 300 } },
            { path: "Archive/Old.md", stat: { mtime: oldTime, ctime: oldTime, size: 500 } },
        ];
        const app = {
            vault: { getMarkdownFiles: () => files },
            metadataCache: {
                getFileCache: () => ({ tags: [], frontmatter: {} }),
                resolvedLinks: {},
                unresolvedLinks: {},
            },
        };
        const analyzer = new TypeCVaultMetacognitionAnalyzer(app as any);
        const snapshot = await analyzer.analyze(now);

        expect(snapshot.trends.length).toBeGreaterThan(0);
        const trendLabels = snapshot.trends.map((t) => t.label);
        expect(trendLabels).toContain("Active");
        // "Archive" folder has only the old file (60 days ago, beyond 30-day cutoff)
        expect(trendLabels).not.toContain("Archive");
    });
});
