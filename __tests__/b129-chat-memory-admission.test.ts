import type { App } from "obsidian";
import type { ChatHistoryManager } from "../src/chat/chat-history-manager";
import type { PersistedTurn } from "../src/chat/chat-history-store";
import type { ChatHostProvenance } from "../src/ai-services/chat-provenance";
import { TypeAUserProfileExtractor } from "../src/ai-services/memory-extraction/type-a-extractor";
import { MemoryExtractionScheduler, type TypeAAdmissionBatch } from "../src/ai-services/memory-extraction/extraction-scheduler";
import { MemoryUserProfileStore } from "../src/ai-services/memory-extraction/profile-store";
import { SerializedProfileGovernancePort } from "../src/ai-services/memory-extraction/profile-governance-port";
import {
    classifyChatUserProvenanceKind,
    collectChatMemorySources,
    createChatMemoryCandidateEvidence,
    isChatMemoryRecordAdmissible,
} from "../src/pa/chat-memory-admission";

const NOW = "2026-09-06T09:00:00.000Z";
const conversation = { id: "c1", title: "Fixture", createdAt: NOW, updatedAt: NOW, turnCount: 8, preview: "" };
const preference = "Remember I prefer answers in Chinese.";

function turn(id: string, kind: ChatHostProvenance["kind"], text = preference, index = 1): PersistedTurn {
    return { conversationId: "c1", turnIndex: index,
        user: { role: "user", content: text, hostProvenance: { version: 1, messageId: id, kind } },
        assistant: { role: "assistant", content: "AI_SECRET_DRAFT I always use lyrical captions.",
            hostProvenance: { version: 1, messageId: `assistant-${id}`, kind: "ai_draft" } } };
}

describe("B-129 host classification for automatic Memory", () => {
    it.each([
        ["这次图片文案短一点", true, true, "user_local_edit"],
        ["短一点", false, true, "user_local_edit"],
        ["Make it shorter", false, true, "user_local_edit"],
        ["Make it shorter", false, false, "user_local_edit"],
        ["Rewrite this caption", false, false, "user_local_edit"],
        ["图片里是什么？", true, false, "writing_request"],
        ["What is in the image?", true, false, "writing_request"],
        ["写一段旅行文案", false, false, "writing_request"],
        ["以后默认用中文回复", true, true, "ordinary_user_statement"],
        ["Always answer in English", false, true, "ordinary_user_statement"],
        ["I prefer concise answers", false, true, "ordinary_user_statement"],
        ["I prefer hiking on weekends", false, true, "ordinary_user_statement"],
        ["我更喜欢周末去徒步", false, true, "ordinary_user_statement"],
        ["换个话题，杭州今天的天气怎么样", false, true, "ordinary_user_statement"],
        ["Different question: what is the weather today?", false, true, "ordinary_user_statement"],
        ["I work in software engineering", false, true, "ordinary_user_statement"],
        ["我是一名软件工程师", false, true, "ordinary_user_statement"],
        ["Remember I prefer signed Conventional Commits", false, false, "ordinary_user_statement"],
        ["I prefer this draft to be shorter", false, true, "user_local_edit"],
    ] as const)("classifies %s using host context", (text, hasImages, writingContext, expected) => {
        expect(classifyChatUserProvenanceKind(text, { hasImages, writingContext })).toBe(expected);
    });

    it.each([null, undefined, {}, { version: 2, messageId: "u", kind: "ordinary_user_statement" },
        { version: 1, messageId: "u", kind: "user_explicit" }])("does not downgrade invalid new provenance to a legacy statement", (invalid) => {
        const input = turn("u", "ordinary_user_statement");
        (input.user as unknown as { hostProvenance: unknown }).hostProvenance = invalid;
        expect(collectChatMemorySources("c1", [input])).toEqual([]);
    });

    it("retains ordinary old text preferences without accepting old local-writing commands", () => {
        const ordinary = turn("ordinary", "ordinary_user_statement");
        delete ordinary.user.hostProvenance;
        const writing = turn("writing", "writing_request", "这次图片文案短一点", 2);
        delete writing.user.hostProvenance;
        expect(collectChatMemorySources("c1", [ordinary, writing]).map((source) => source.text)).toEqual([preference]);
    });

    it("rejects ambiguous repeated host message IDs, including an ID reused by a blocked user turn", () => {
        expect(collectChatMemorySources("c1", [turn("u", "ordinary_user_statement"),
            turn("u", "user_local_edit", preference, 2)])).toEqual([]);
    });
});

describe("B-129 extraction input and host-bound candidate evidence", () => {
    const extractor = new TypeAUserProfileExtractor();
    it("excludes every nonordinary class and all assistant text from the actual model input", async () => {
        const turns = [turn("ordinary", "ordinary_user_statement"),
            ...(["ai_draft", "user_local_edit", "writing_request", "explicit_style_action"] as const)
                .map((kind, i) => turn(kind, kind, `BLOCKED_${kind} I prefer lyrical responses.`, i + 2))];
        const invoke = jest.fn(async (_prompt: string) => JSON.stringify({ extractions: [{ text: preference,
            kind: "user_explicit", confidence: "high", sourceMessageIds: ["ordinary"],
            chatEvidence: { version: 999, sources: ["forged"] } }] }));
        const candidates = await extractor.extractCandidatesWithLLM({ conversation, turns }, invoke);
        expect(invoke.mock.calls[0][0]).toContain(preference);
        expect(invoke.mock.calls[0][0]).not.toMatch(/AI_SECRET_DRAFT|BLOCKED_/);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].chatEvidence).toMatchObject({ version: 1, sources: [{ messageId: "ordinary", kind: "ordinary_user_statement" }] });
        expect(JSON.stringify(candidates[0].chatEvidence)).not.toContain(preference);
    });

    it.each([[], ["missing"], ["writing"], ["ordinary", "writing"], ["assistant-ordinary"]]
        .map((sourceMessageIds) => ({ sourceMessageIds })))("model-supplied IDs $sourceMessageIds cannot manufacture evidence", async ({ sourceMessageIds }) => {
        const turns = [turn("ordinary", "ordinary_user_statement", "Tell me the weather."),
            turn("writing", "writing_request", "I prefer this caption shorter.", 2)];
        const candidates = await extractor.extractCandidatesWithLLM({ conversation, turns }, async () => JSON.stringify({
            extractions: [{ text: "I prefer poetic answers", kind: "user_explicit", confidence: "high", sourceMessageIds }],
        }));
        expect(candidates).toEqual([]);
    });

    it("falls back to real ordinary user text when an older model omits source IDs", async () => {
        const candidates = await extractor.extractCandidatesWithLLM({ conversation,
            turns: [turn("ordinary", "ordinary_user_statement")] }, async () => JSON.stringify({
            extractions: [{ text: "I prefer poetic captions", kind: "user_explicit", confidence: "high" }],
        }));
        expect(candidates.map((candidate) => candidate.text)).toEqual([preference]);
        expect(candidates[0].chatEvidence?.sources[0].messageId).toBe("ordinary");
    });

    it("does not call a model or extract regex candidates for an image question or local edit alone", async () => {
        const invoke = jest.fn(async () => "{}");
        const input = { conversation, turns: [turn("image", "writing_request", "我更喜欢这张照片。"),
            turn("edit", "user_local_edit", "不要用长句", 2)] };
        expect(extractor.extractCandidates(input)).toEqual([]);
        expect(await extractor.extractCandidatesWithLLM(input, invoke)).toEqual([]);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("rejects changed text, another conversation, missing host messages and mismatched source hashes", () => {
        const source = collectChatMemorySources("c1", [turn("ordinary", "ordinary_user_statement")])[0];
        const record = { text: preference, conversationId: "c1", chatEvidence: createChatMemoryCandidateEvidence(preference, [source]) };
        const evidence = { conversationId: "c1", throughTurnIndex: 1, chatMessages: [source] };
        expect(isChatMemoryRecordAdmissible(record, evidence)).toBe(true);
        expect(isChatMemoryRecordAdmissible({ ...record, text: "I prefer invented facts" }, evidence)).toBe(false);
        expect(isChatMemoryRecordAdmissible({ ...record, conversationId: "other" }, evidence)).toBe(false);
        expect(isChatMemoryRecordAdmissible(record, { ...evidence, chatMessages: undefined })).toBe(false);
        expect(isChatMemoryRecordAdmissible(record, { ...evidence, chatMessages: [{ ...source, contentHash: "changed" }] })).toBe(false);
    });
});

describe("B-129 actual scheduler admission branches", () => {
    it.each(["governed", "legacy"] as const)("admits only a genuine preference in a mixed %s batch", async (route) => {
        const store = new MemoryUserProfileStore();
        const admittedRecords: string[] = [];
        const admission = jest.fn(async (batch: TypeAAdmissionBatch) => {
            for (const record of batch.proposed.records) {
                if (isChatMemoryRecordAdmissible(record, batch.evidence)) admittedRecords.push(record.text);
            }
            return { status: "processed" as const };
        });
        const turns = [turn("ordinary", "ordinary_user_statement"), turn("write", "writing_request", "I prefer this caption shorter", 2),
            turn("action", "explicit_style_action", "Remember I prefer this style", 3)];
        const scheduler = new MemoryExtractionScheduler({ app: {} as App, userProfileStore: store,
            chatHistoryManager: { findConversation: async () => conversation, getTurns: async () => turns } as unknown as ChatHistoryManager,
            createModelForExtraction: async () => ({ invoke: async () => JSON.stringify({ extractions: [
                { text: preference, kind: "user_explicit", confidence: "high", sourceMessageIds: ["ordinary"] },
                { text: "I prefer short captions", kind: "user_explicit", confidence: "high", sourceMessageIds: ["write"] },
                { text: "I prefer this style everywhere", kind: "user_explicit", confidence: "high", sourceMessageIds: ["action"] },
            ] }) }), ...(route === "governed" ? { admitTypeACandidates: admission } : {}), now: () => new Date(NOW) });
        try {
            await scheduler.runTypeAExtraction("c1");
            if (route === "governed") {
                expect(admittedRecords).toEqual([preference]);
                expect(await store.getProfile()).toBeNull();
                expect(admission.mock.calls[0][0].candidates).toHaveLength(1);
            } else {
                expect((await store.getProfile())?.records.map((record) => record.text)).toEqual([preference]);
                expect(scheduler.getPromptContext().userProfile).not.toMatch(/caption|everywhere/);
            }
        } finally { scheduler.dispose(); }
    });

    it.each(["governed", "legacy"] as const)("guards the %s boundary even when an extractor returns an unbound fabricated preference", async (route) => {
        const store = new MemoryUserProfileStore();
        const admission = jest.fn(async (_batch: TypeAAdmissionBatch) => ({ status: "processed" as const }));
        const scheduler = new MemoryExtractionScheduler({ app: {} as App, userProfileStore: store,
            chatHistoryManager: { findConversation: async () => conversation,
                getTurns: async () => [turn("write", "writing_request")] } as unknown as ChatHistoryManager,
            ...(route === "governed" ? { admitTypeACandidates: admission } : {}) });
        const extract = jest.spyOn(TypeAUserProfileExtractor.prototype, "extractCandidates").mockReturnValue([
            { key: "forged", text: preference, kind: "user_explicit", confidence: "high", conversationId: "c1", observedAt: NOW },
        ]);
        try {
            await scheduler.runTypeAExtraction("c1");
            if (route === "governed") expect(admission.mock.calls[0][0].proposed.records).toEqual([]);
            else expect((await store.getProfile())?.records).toEqual([]);
        } finally { extract.mockRestore(); scheduler.dispose(); }
    });

    it("preserves receipt isolation through legacy store and serialized governance snapshots", async () => {
        const store = new MemoryUserProfileStore();
        const extractor = new TypeAUserProfileExtractor();
        const snapshot = extractor.mergeCandidates(null, extractor.extractCandidates({ conversation,
            turns: [turn("ordinary", "ordinary_user_statement")] }));
        await store.setProfile(snapshot);
        snapshot.records[0].chatEvidence!.sources[0].messageId = "mutated-input";
        const loaded = (await store.getProfile())!;
        expect(loaded.records[0].chatEvidence!.sources[0].messageId).toBe("ordinary");
        loaded.records[0].chatEvidence!.sources[0].messageId = "mutated-output";
        const port = new SerializedProfileGovernancePort(store);
        try {
            const first = (await port.initialize())!;
            first.records[0].chatEvidence!.sources[0].messageId = "mutated-port-output";
            expect(port.readSnapshot()!.records[0].chatEvidence!.sources[0].messageId).toBe("ordinary");
        } finally { await port.dispose(); }
    });
});
