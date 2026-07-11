import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { TFile } from "obsidian";

import {
    MemoryExtractionScheduler,
    MemoryUserProfileStore,
    TypeAUserProfileExtractor,
    TypeCVaultMetacognitionAnalyzer,
    extractCandidatesFromText,
    renderUserProfileMarkdown,
    sanitizeUserProfileMarkdownForPrompt,
    sanitizeUserProfileSnapshot,
} from "../src/ai-services/memory-extraction";
import type {
    AdmitTypeACandidates,
    UserProfileCandidate,
    UserProfileRecord,
    VaultMetacognitionSnapshot,
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

    it("splits profile candidates at sentence and newline boundaries without lookbehind syntax", () => {
        const candidates = extractCandidatesFromText(
            [
                "Remember I prefer concise answers. Please remember I usually write docs in Chinese.",
                "Note that I always want signed commits.",
            ].join("\n"),
            "c-split",
            "2026-06-16T08:00:00.000Z",
        );

        expect(candidates.map((candidate) => candidate.text)).toEqual([
            "Remember I prefer concise answers.",
            "Please remember I usually write docs in Chinese.",
            "Note that I always want signed commits.",
        ]);
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

    it("does not extract one-off no-web weather constraints into User Profile", () => {
        const candidates = extractCandidatesFromText(
            "不要联网，看一下杭州今天的天气。",
            "c-no-web-once",
            "2026-06-16T08:00:00.000Z",
        );

        expect(candidates).toHaveLength(0);
    });

    it("keeps explicit future/default web search preferences eligible for User Profile", () => {
        const extractor = new TypeAUserProfileExtractor();
        const candidates = extractCandidatesFromText(
            "以后默认不要用 web search。",
            "c-no-web-default",
            "2026-06-16T08:00:00.000Z",
        );
        const snapshot = extractor.mergeCandidates(null, candidates, new Date("2026-06-16T08:00:00.000Z"));

        expect(candidates).toHaveLength(1);
        expect(snapshot.records[0].confirmed).toBe(true);
        expect(snapshot.markdown).toContain("以后默认不要用 web search");
    });

    it("keeps explicit English durable web search preferences eligible for User Profile", () => {
        const extractor = new TypeAUserProfileExtractor();
        const candidates = extractCandidatesFromText(
            "Always avoid web search unless I explicitly ask for it.",
            "c-no-web-always",
            "2026-06-16T08:00:00.000Z",
        );
        const snapshot = extractor.mergeCandidates(null, candidates, new Date("2026-06-16T08:00:00.000Z"));

        expect(candidates).toHaveLength(1);
        expect(snapshot.markdown).toContain("Always avoid web search unless I explicitly ask for it.");
    });

    it("does not extract this-turn web search constraints into User Profile", () => {
        const candidates = extractCandidatesFromText(
            "这次不要用 web search。",
            "c-no-web-this-turn",
            "2026-06-16T08:00:00.000Z",
        );

        expect(candidates).toHaveLength(0);
    });

    it("does not extract one-off current-note or notes-only source constraints into User Profile", () => {
        expect(extractCandidatesFromText(
            "只看当前笔记。",
            "c-current-note-only",
            "2026-06-16T08:00:00.000Z",
        )).toHaveLength(0);
        expect(extractCandidatesFromText(
            "Only use my notes for this answer.",
            "c-notes-only",
            "2026-06-16T08:00:00.000Z",
        )).toHaveLength(0);
    });

    it("filters LLM-extracted one-off tool constraints before merging profile candidates", async () => {
        const extractor = new TypeAUserProfileExtractor();
        const candidates = await extractor.extractCandidatesWithLLM({
            conversation: {
                id: "c-llm-no-web",
                title: "Weather",
                createdAt: "2026-06-16T00:00:00.000Z",
                updatedAt: "2026-06-16T00:00:00.000Z",
                turnCount: 1,
                preview: "Weather",
            },
            turns: [{
                conversationId: "c-llm-no-web",
                turnIndex: 1,
                user: { role: "user", content: "不要联网，看一下杭州今天的天气。" },
                assistant: { role: "assistant", content: "不联网时无法核验实时天气。" },
            }],
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        }, async () => JSON.stringify({
            extractions: [{
                text: "不要联网，看一下杭州今天的天气。",
                kind: "user_correction",
                confidence: "high",
            }],
        }));

        expect(candidates).toHaveLength(0);
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
        expect(snapshot1.records[0].profileRecordId).toMatch(/^profile-[a-f0-9]{32}$/);
        const immutableProfileRecordId = snapshot1.records[0].profileRecordId;

        const snapshot2 = extractor.mergeCandidates(snapshot1, [makeCandidate("conv-2")], now);
        expect(snapshot2.records[0].confirmed).toBe(false);
        expect(snapshot2.records[0].occurrences).toBe(2);

        const snapshot3 = extractor.mergeCandidates(snapshot2, [makeCandidate("conv-3")], now);
        expect(snapshot3.records[0].confirmed).toBe(true);
        expect(snapshot3.records[0].occurrences).toBe(3);
        expect(snapshot3.records[0].profileRecordId).toBe(immutableProfileRecordId);
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

    it("sanitizes existing polluted no-web records from stored User Profile snapshots", () => {
        const snapshot = sanitizeUserProfileSnapshot({
            updatedAt: "2026-06-15T08:00:00.000Z",
            records: [
                {
                    key: "one-off-no-web",
                    text: "不要联网，看一下杭州今天的天气。",
                    kind: "user_correction",
                    confidence: "high",
                    conversationId: "c-old",
                    observedAt: "2026-06-15T08:00:00.000Z",
                    occurrences: 1,
                    conversationIds: ["c-old"],
                    confirmed: true,
                },
                {
                    key: "style",
                    text: "不要用列表格式",
                    kind: "user_correction",
                    confidence: "high",
                    conversationId: "c-style",
                    observedAt: "2026-06-15T08:00:00.000Z",
                    occurrences: 1,
                    conversationIds: ["c-style"],
                    confirmed: true,
                },
            ],
            markdown: [
                "# User Profile",
                "- 不要联网，看一下杭州今天的天气。",
                "- 不要用列表格式",
            ].join("\n"),
        }, new Date("2026-06-16T08:00:00.000Z"));

        expect(snapshot?.records.map((record) => record.text)).toEqual(["不要用列表格式"]);
        expect(snapshot?.records[0].profileRecordId).toMatch(/^profile-[a-f0-9]{32}$/);
        expect(snapshot?.markdown).not.toContain("不要联网");
        expect(snapshot?.markdown).toContain("不要用列表格式");
    });

    it("sanitizes polluted profile markdown before prompt injection", () => {
        const sanitized = sanitizeUserProfileMarkdownForPrompt([
            "# User Profile",
            "- 不要联网，看一下杭州今天的天气。",
            "- 以后默认不要用 web search。",
            "- Remember I prefer concise Conventional Commits.",
        ].join("\n"));

        expect(sanitized).not.toContain("杭州今天的天气");
        expect(sanitized).not.toContain("以后默认不要用 web search");
        expect(sanitized).toContain("Remember I prefer concise Conventional Commits.");
    });
});

describe("MemoryExtractionScheduler", () => {
    it("updates the scheduler prompt cache through the serialized Profile governance port", async () => {
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: {
                findConversation: jest.fn(async () => null),
                getTurns: jest.fn(async () => []),
            } as any,
            userProfileStore: new MemoryUserProfileStore(),
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        const next = await scheduler.mutateUserProfile(() => ({
            updatedAt: "2026-06-16T08:00:00.000Z",
            records: [{
                key: "response-style",
                text: "Remember I prefer concise Conventional Commits.",
                kind: "user_explicit",
                confidence: "high",
                conversationId: "conversation-1",
                observedAt: "2026-06-16T08:00:00.000Z",
                occurrences: 1,
                conversationIds: ["conversation-1"],
                confirmed: true,
            }],
            markdown: "# User Profile\n- Remember I prefer concise Conventional Commits.",
        }));

        expect(next.records[0].profileRecordId).toMatch(/^profile-[a-f0-9]{32}$/);
        expect(scheduler.getPromptContext().userProfile).toContain("concise Conventional Commits");
        scheduler.dispose();
    });

    it("sanitizes and persists polluted stored User Profile snapshots on load", async () => {
        const storedProfile = {
            updatedAt: "2026-06-15T08:00:00.000Z",
            records: [
                {
                    key: "one-off-no-web",
                    text: "不要联网，看一下杭州今天的天气。",
                    kind: "user_correction" as const,
                    confidence: "high" as const,
                    conversationId: "c-old",
                    observedAt: "2026-06-15T08:00:00.000Z",
                    occurrences: 1,
                    conversationIds: ["c-old"],
                    confirmed: true,
                },
                {
                    key: "style",
                    text: "Remember I prefer concise Conventional Commits.",
                    kind: "user_explicit" as const,
                    confidence: "high" as const,
                    conversationId: "c-style",
                    observedAt: "2026-06-15T08:00:00.000Z",
                    occurrences: 1,
                    conversationIds: ["c-style"],
                    confirmed: true,
                },
            ],
            markdown: [
                "# User Profile",
                "- Remember I prefer concise Conventional Commits.",
            ].join("\n"),
        };
        const userProfileStore = {
            initialize: jest.fn(async () => undefined),
            getProfile: jest.fn(async () => storedProfile),
            setProfile: jest.fn(async (_snapshot: unknown) => undefined),
            dispose: jest.fn(async () => undefined),
        };
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: {
                findConversation: jest.fn(async () => null),
                getTurns: jest.fn(),
            } as any,
            userProfileStore,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        const snapshot = await scheduler.runTypeAExtraction("missing");

        expect(snapshot?.records.map((record) => record.text)).toEqual([
            "Remember I prefer concise Conventional Commits.",
        ]);
        expect(snapshot?.markdown).not.toContain("不要联网");
        expect(userProfileStore.setProfile).toHaveBeenCalledWith(expect.objectContaining({
            records: [expect.objectContaining({ text: "Remember I prefer concise Conventional Commits." })],
            markdown: expect.not.stringContaining("不要联网"),
        }));
    });

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

    it("routes Type A through governed admission without directly writing ProfileStore", async () => {
        const userProfileStore = new MemoryUserProfileStore();
        const admitTypeACandidates = jest.fn<AdmitTypeACandidates>(async () => ({ status: "processed" }));
        const baseline = { version: 1 as const, capturedCommitSequence: 3, targets: {} };
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
                user: { role: "user", content: "Remember I prefer concise answers." },
                assistant: { role: "assistant", content: "Noted." },
            }]),
        };
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: chatHistoryManager as any,
            userProfileStore,
            admitTypeACandidates,
            captureTypeAAdmissionBaseline: async () => baseline,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        const snapshot = await scheduler.runTypeAExtraction("c1");

        expect(admitTypeACandidates).toHaveBeenCalledWith(expect.objectContaining({
            current: null,
            proposed: expect.objectContaining({ records: [expect.objectContaining({ confirmed: true })] }),
            candidates: [expect.objectContaining({ kind: "user_explicit" })],
            baseline,
            evidence: { conversationId: "c1", throughTurnIndex: 1 },
        }));
        expect(snapshot).toBeNull();
        expect(await userProfileStore.getProfile()).toBeNull();
    });

    it("retries the same Type A turn when governed admission throws before completion", async () => {
        const admitTypeACandidates = jest.fn<AdmitTypeACandidates>()
            .mockRejectedValueOnce(new Error("governance unavailable"))
            .mockImplementationOnce(async () => ({ status: "processed" }));
        const chatHistoryManager = {
            findConversation: jest.fn(async () => ({ id: "c1" })),
            getTurns: jest.fn(async () => [{
                conversationId: "c1",
                turnIndex: 1,
                user: { role: "user", content: "Remember I prefer concise answers." },
                assistant: { role: "assistant", content: "Noted." },
            }]),
        };
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: chatHistoryManager as any,
            userProfileStore: new MemoryUserProfileStore(),
            admitTypeACandidates,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        await expect(scheduler.runTypeAExtraction("c1")).rejects.toThrow("governance unavailable");
        await expect(scheduler.runTypeAExtraction("c1")).resolves.toBeNull();
        expect(admitTypeACandidates).toHaveBeenCalledTimes(2);
    });

    it("does not advance a governed Type-A turn when admission requests retry", async () => {
        const admitTypeACandidates = jest.fn<AdmitTypeACandidates>()
            .mockResolvedValueOnce({ status: "retry" })
            .mockResolvedValueOnce({ status: "processed" });
        const chatHistoryManager = {
            findConversation: jest.fn(async () => ({ id: "c1" })),
            getTurns: jest.fn(async () => [{
                conversationId: "c1",
                turnIndex: 1,
                user: { role: "user", content: "Remember I prefer concise answers." },
                assistant: { role: "assistant", content: "Noted." },
            }]),
        };
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: chatHistoryManager as any,
            userProfileStore: new MemoryUserProfileStore(),
            admitTypeACandidates,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        await scheduler.runTypeAExtraction("c1");
        await scheduler.runTypeAExtraction("c1");
        expect(admitTypeACandidates).toHaveBeenCalledTimes(2);
    });

    it("skips turns already covered by the durable governed cursor after restart", async () => {
        const admitTypeACandidates = jest.fn<AdmitTypeACandidates>();
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: {
                findConversation: jest.fn(async () => ({ id: "c1" })),
                getTurns: jest.fn(async () => [{
                    conversationId: "c1",
                    turnIndex: 1,
                    user: { role: "user", content: "Remember I prefer concise answers." },
                    assistant: { role: "assistant", content: "Noted." },
                }]),
            } as any,
            userProfileStore: new MemoryUserProfileStore(),
            admitTypeACandidates,
            getTypeAProcessedTurn: async () => 1,
        });

        await expect(scheduler.runTypeAExtraction("c1")).resolves.toBeNull();
        expect(admitTypeACandidates).not.toHaveBeenCalled();
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

    it("keeps Type C disabled by default and does not inject vault insights into prompts", async () => {
        const write = jest.fn();
        const getMarkdownFiles = jest.fn(() => []);
        const app = {
            vault: {
                getMarkdownFiles,
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

        expect(getMarkdownFiles).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(scheduler.getPromptContext().vaultInsights).toBeUndefined();
    });

    it("injects Vault Insights only while the include setting is enabled", async () => {
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
            includeVaultInsightsInPrompt: true,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        await scheduler.runTypeCRefresh("test");

        expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
        expect(scheduler.getPromptContext().vaultInsights).toContain("# Vault Insights");

        scheduler.setIncludeVaultInsightsInPrompt(false);
        expect(scheduler.getPromptContext().vaultInsights).toBeUndefined();

        await scheduler.runTypeCRefresh("after-disable");
        expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
    });

    it("returns clone-safe snapshots and excludes stale-boundary Vault Insights from prompts", async () => {
        let boundaryFingerprint = "boundary:v1";
        const scheduler = new MemoryExtractionScheduler({
            app: {
                vault: { getMarkdownFiles: jest.fn(() => []) },
                metadataCache: {
                    getFileCache: jest.fn(),
                    resolvedLinks: {},
                    unresolvedLinks: {},
                },
            } as any,
            chatHistoryManager: {
                findConversation: jest.fn(),
                getTurns: jest.fn(),
            } as any,
            userProfileStore: new MemoryUserProfileStore(),
            includeVaultInsightsInPrompt: true,
            getDataBoundaryFingerprint: () => boundaryFingerprint,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        await scheduler.runTypeCRefresh("test");
        const first = scheduler.getVaultInsightsSnapshot();

        expect(scheduler.getVaultInsightsStatus()).toBe("ready");
        expect(first?.dataBoundaryFingerprint).toBe("boundary:v1");
        expect(scheduler.getPromptContext().vaultInsights).toContain("# Vault Insights");

        if (first) first.snapshot.folderThemes.push({ folder: "mutated", count: 99 });
        expect(scheduler.getVaultInsightsSnapshot()?.snapshot.folderThemes).toEqual([]);

        boundaryFingerprint = "boundary:v2";
        expect(scheduler.getVaultInsightsStatus()).toBe("stale_boundary");
        expect(scheduler.getPromptContext().vaultInsights).toBeUndefined();
        expect(scheduler.getInsightsViewerContext().vaultInsights).toBeUndefined();
        expect(scheduler.getVaultInsightsSnapshot()?.dataBoundaryFingerprint).toBe("boundary:v1");
    });

    it("discards a Type C refresh when the Data Boundary changes during analysis", async () => {
        jest.useFakeTimers();
        try {
            let boundaryFingerprint = "boundary:v1";
            let resolveAnalysis: ((snapshot: VaultMetacognitionSnapshot) => void) | undefined;
            const analysis = new Promise<VaultMetacognitionSnapshot>((resolve) => {
                resolveAnalysis = resolve;
            });
            const scheduler = new MemoryExtractionScheduler({
                app: { vault: { getMarkdownFiles: jest.fn(() => []) }, metadataCache: {} } as any,
                chatHistoryManager: { findConversation: jest.fn(), getTurns: jest.fn() } as any,
                userProfileStore: new MemoryUserProfileStore(),
                includeVaultInsightsInPrompt: true,
                getDataBoundaryFingerprint: () => boundaryFingerprint,
                now: () => new Date("2026-06-16T08:00:00.000Z"),
            });
            const analyze = jest.fn(() => analysis);
            (scheduler as any).typeCAnalyzer.analyze = analyze;

            const refresh = scheduler.runTypeCRefresh("test");
            await Promise.resolve();
            boundaryFingerprint = "boundary:v2";
            resolveAnalysis?.({
                generatedAt: "2026-06-16T08:00:00.000Z",
                fileCount: 1,
                folderThemes: [],
                tagTaxonomy: [],
                linkTopology: { hubNotes: [], unresolvedLinks: [] },
                writingHabits: { busiestWeekdays: [], averageWords: 0, recentlyActive: [] },
                topicClusters: [],
                knowledgeGaps: [],
                trends: [],
            });

            await expect(refresh).resolves.toBeNull();
            expect(scheduler.getVaultInsightsSnapshot()).toBeNull();
            expect(scheduler.getPromptContext().vaultInsights).toBeUndefined();
            expect(scheduler.getVaultInsightsStatus()).toBe("not_loaded");
            expect(analyze).toHaveBeenCalledTimes(1);
            scheduler.dispose();
        } finally {
            jest.useRealTimers();
        }
    });

    it("reports a redacted Type C error until a successful first snapshot is available", async () => {
        const scheduler = new MemoryExtractionScheduler({
            app: { vault: { getMarkdownFiles: jest.fn(() => []) }, metadataCache: {} } as any,
            chatHistoryManager: { findConversation: jest.fn(), getTurns: jest.fn() } as any,
            userProfileStore: new MemoryUserProfileStore(),
            includeVaultInsightsInPrompt: true,
            getDataBoundaryFingerprint: () => "boundary:v1",
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });
        const snapshot: VaultMetacognitionSnapshot = {
            generatedAt: "2026-06-16T08:00:00.000Z",
            fileCount: 0,
            folderThemes: [],
            tagTaxonomy: [],
            linkTopology: { hubNotes: [], unresolvedLinks: [] },
            writingHabits: { busiestWeekdays: [], averageWords: 0, recentlyActive: [] },
            topicClusters: [],
            knowledgeGaps: [],
            trends: [],
        };
        const analyze = jest.fn<() => Promise<VaultMetacognitionSnapshot>>()
            .mockRejectedValueOnce(new Error("private provider detail"))
            .mockResolvedValue(snapshot);
        (scheduler as any).typeCAnalyzer.analyze = analyze;

        await expect(scheduler.runTypeCRefresh("fail")).rejects.toThrow("private provider detail");
        expect(scheduler.getVaultInsightsStatus()).toBe("error");
        expect(scheduler.getVaultInsightsSnapshot()).toBeNull();

        await expect(scheduler.runTypeCRefresh("recover")).resolves.toEqual(snapshot);
        expect(scheduler.getVaultInsightsStatus()).toBe("ready");

        analyze.mockRejectedValueOnce(new Error("later refresh failed"));
        await expect(scheduler.runTypeCRefresh("later-fail")).rejects.toThrow("later refresh failed");
        expect(scheduler.getVaultInsightsStatus()).toBe("ready");
        expect(scheduler.getPromptContext().vaultInsights).toContain("# Vault Insights");
    });

    it("returns a clone-safe already-loaded Type A snapshot without starting extraction", async () => {
        const userProfileStore = new MemoryUserProfileStore();
        const findConversation = jest.fn(async () => ({
            id: "c1",
            title: "Prefs",
            createdAt: "2026-06-16T00:00:00.000Z",
            updatedAt: "2026-06-16T00:00:00.000Z",
            turnCount: 1,
            preview: "Remember",
        }));
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: {
                findConversation,
                getTurns: jest.fn(async () => [{
                    conversationId: "c1",
                    turnIndex: 1,
                    user: { role: "user", content: "Remember I prefer concise answers." },
                    assistant: { role: "assistant", content: "Noted." },
                }]),
            } as any,
            userProfileStore,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        expect(scheduler.getUserProfileSnapshot()).toBeNull();
        expect(findConversation).not.toHaveBeenCalled();

        await scheduler.runTypeAExtraction("c1");
        const first = scheduler.getUserProfileSnapshot();
        expect(first?.records).toHaveLength(1);
        if (first) first.records[0].conversationIds.push("mutated");
        expect(scheduler.getUserProfileSnapshot()?.records[0].conversationIds).toEqual(["c1"]);
    });

    it("keeps full Vault Insights for the viewer while prompt context is summarized", () => {
        const scheduler = new MemoryExtractionScheduler({
            app: { vault: { getMarkdownFiles: () => [] }, metadataCache: {} } as any,
            chatHistoryManager: {
                findConversation: jest.fn(),
                getTurns: jest.fn(),
            } as any,
            userProfileStore: new MemoryUserProfileStore(),
            includeVaultInsightsInPrompt: true,
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });
        const fullMarkdown = [
            "# Vault Insights",
            ...Array.from({ length: 45 }, (_, i) => `- Insight line ${i + 1}`),
        ].join("\n");
        (scheduler as any).vaultInsightsMarkdown = fullMarkdown;
        (scheduler as any).vaultSnapshot = {};
        (scheduler as any).vaultSnapshotDataBoundaryFingerprint = "data_boundary:unknown";

        expect(scheduler.getPromptContext().vaultInsights).not.toContain("Insight line 45");
        expect(scheduler.getInsightsViewerContext().vaultInsights).toContain("Insight line 45");
    });
});

describe("MemoryExtractionScheduler lifecycle", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("handles an immediately rejected scheduled baseline before the timer fires", async () => {
        const baselineError = new Error("baseline unavailable");
        const log = jest.fn();
        const admitTypeACandidates = jest.fn<AdmitTypeACandidates>(async () => ({ status: "processed" }));
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: {
                findConversation: jest.fn(),
                getTurns: jest.fn(),
            } as any,
            userProfileStore: new MemoryUserProfileStore(),
            admitTypeACandidates,
            captureTypeAAdmissionBaseline: () => Promise.reject(baselineError),
            log,
        });

        scheduler.scheduleTypeAExtraction("c1", 1, 1_000);
        await Promise.resolve();

        expect(log).not.toHaveBeenCalled();
        expect(admitTypeACandidates).not.toHaveBeenCalled();
        expect((scheduler as any).typeAProcessedTurnByConversation.size).toBe(0);

        await jest.advanceTimersByTimeAsync(1_000);

        expect(log).toHaveBeenCalledWith("Type A user profile extraction failed", baselineError);
        expect(admitTypeACandidates).not.toHaveBeenCalled();
        expect((scheduler as any).typeAProcessedTurnByConversation.size).toBe(0);
        scheduler.dispose();
    });

    it("settles a rejected baseline when a later schedule replaces its timer", async () => {
        const cancelledError = new Error("cancelled baseline unavailable");
        const baseline = { version: 1 as const, capturedCommitSequence: 4, targets: {} };
        const captureTypeAAdmissionBaseline = jest.fn(async () => baseline)
            .mockRejectedValueOnce(cancelledError);
        const log = jest.fn();
        const admitTypeACandidates = jest.fn<AdmitTypeACandidates>(async () => ({ status: "processed" }));
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: {
                findConversation: jest.fn(async (conversationId: string) => ({ id: conversationId })),
                getTurns: jest.fn(async (conversationId: string) => [{
                    conversationId,
                    turnIndex: 1,
                    user: { role: "user", content: "Remember I prefer concise answers." },
                    assistant: { role: "assistant", content: "Noted." },
                }]),
            } as any,
            userProfileStore: new MemoryUserProfileStore(),
            admitTypeACandidates,
            captureTypeAAdmissionBaseline,
            log,
        });

        scheduler.scheduleTypeAExtraction("cancelled", 1, 1_000);
        scheduler.scheduleTypeAExtraction("replacement", 1, 1_000);
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(1_000);

        expect(log).not.toHaveBeenCalled();
        expect(admitTypeACandidates).toHaveBeenCalledTimes(1);
        expect(admitTypeACandidates).toHaveBeenCalledWith(expect.objectContaining({
            baseline,
            evidence: { conversationId: "replacement", throughTurnIndex: 1 },
        }));
        expect((scheduler as any).typeAProcessedTurnByConversation.get("cancelled")).toBeUndefined();
        expect((scheduler as any).typeAProcessedTurnByConversation.get("replacement")).toBe(1);
        scheduler.dispose();
    });

    it("settles a pending baseline rejection after dispose without advancing the cursor", async () => {
        const baseline = { version: 1 as const, capturedCommitSequence: 5, targets: {} };
        let rejectBaseline!: (reason: unknown) => void;
        const captureTypeAAdmissionBaseline = jest.fn(() => new Promise<typeof baseline>((_resolve, reject) => {
            rejectBaseline = reject;
        }));
        const log = jest.fn();
        const admitTypeACandidates = jest.fn<AdmitTypeACandidates>(async () => ({ status: "processed" }));
        const scheduler = new MemoryExtractionScheduler({
            app: {} as any,
            chatHistoryManager: {
                findConversation: jest.fn(),
                getTurns: jest.fn(),
            } as any,
            userProfileStore: new MemoryUserProfileStore(),
            admitTypeACandidates,
            captureTypeAAdmissionBaseline,
            log,
        });

        scheduler.scheduleTypeAExtraction("disposed", 1, 1_000);
        scheduler.dispose();
        rejectBaseline(new Error("disposed baseline unavailable"));
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(1_000);

        expect(log).not.toHaveBeenCalled();
        expect(admitTypeACandidates).not.toHaveBeenCalled();
        expect((scheduler as any).typeAProcessedTurnByConversation.size).toBe(0);
    });

    it("start() does not schedule Type C while Vault Insights context is off", () => {
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
        jest.advanceTimersByTime(48 * 60 * 60_000);

        expect(getMarkdownFiles).not.toHaveBeenCalled();
        scheduler.dispose();
    });

    it("start() schedules a Type C refresh when Vault Insights context is on and dispose() cancels pending timers", () => {
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
            includeVaultInsightsInPrompt: true,
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

    it("enabling Vault Insights context schedules one Type C refresh live", () => {
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
        scheduler.setIncludeVaultInsightsInPrompt(true);
        jest.advanceTimersByTime(0);

        expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
        scheduler.dispose();
    });

    it("does not schedule Vault Insights refresh for Data Boundary denied vault events", () => {
        const makeFile = (path: string) => {
            const file = new TFile();
            Object.assign(file, {
                path,
                name: path.split("/").pop() ?? path,
                extension: "md",
            });
            return file;
        };
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
            includeVaultInsightsInPrompt: true,
            shouldHandleVaultEvent: (file) => !file.path.startsWith("private/"),
            now: () => new Date("2026-06-16T08:00:00.000Z"),
        });

        scheduler.handleVaultEvent(makeFile("private/secret.md"), "vault-modify");
        jest.advanceTimersByTime(5 * 60_000);
        expect(getMarkdownFiles).not.toHaveBeenCalled();

        scheduler.handleVaultEvent(makeFile("notes/public.md"), "vault-modify");
        jest.advanceTimersByTime(5 * 60_000);
        expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
        scheduler.dispose();
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

    it("applies Data Boundary filtering before analyzing Vault Insights", async () => {
        const now = new Date("2026-06-16T08:00:00.000Z").getTime();
        const files = [
            { path: "Projects/Allowed.md", stat: { mtime: now, ctime: now, size: 600 } },
            { path: "Private/Secret.md", stat: { mtime: now, ctime: now, size: 1200 } },
        ];
        const app = {
            vault: { getMarkdownFiles: () => files },
            metadataCache: {
                getFileCache: (file: { path: string }) => {
                    if (file.path === "Private/Secret.md") {
                        return { tags: [{ tag: "#secret" }], frontmatter: { tags: ["private"] } };
                    }
                    return { tags: [{ tag: "#public" }], frontmatter: {} };
                },
                resolvedLinks: {
                    "Private/Secret.md": { "Projects/Allowed.md": 3 },
                    "Projects/Allowed.md": { "Private/Secret.md": 1 },
                },
                unresolvedLinks: {
                    "Private/Secret.md": { "Secret Gap": 2 },
                    "Projects/Allowed.md": { "Allowed Gap": 2 },
                },
            },
        };
        const analyzer = new TypeCVaultMetacognitionAnalyzer(app as any, {
            shouldIncludeFile: (file) => !file.path.startsWith("Private/"),
        });
        analyzer.setSemanticClusterProvider(async () => [
            { clusterId: 1, label: "Private", paths: ["Projects/Allowed.md", "Private/Secret.md"] },
        ]);

        const snapshot = await analyzer.analyze(new Date(now));
        const markdown = analyzer.renderMarkdown(snapshot);

        expect(snapshot.fileCount).toBe(1);
        expect(snapshot.folderThemes).toEqual([{ folder: "Projects", count: 1 }]);
        expect(snapshot.tagTaxonomy).toEqual([{ tag: "#public", count: 1 }]);
        expect(snapshot.linkTopology.hubNotes[0]).toMatchObject({
            path: "Projects/Allowed.md",
            inbound: 0,
            outbound: 0,
        });
        expect(snapshot.knowledgeGaps.map((gap) => gap.label)).toEqual(["Allowed Gap"]);
        expect(snapshot.topicClusters).toEqual([{ label: "Projects", paths: ["Projects/Allowed.md"] }]);
        expect(markdown).not.toContain("Private/Secret.md");
        expect(markdown).not.toContain("Private:");
        expect(markdown).not.toContain("#secret");
        expect(markdown).not.toContain("Secret Gap");
    });
});
