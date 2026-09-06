import { describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/ai-services/append-tool-provider", () => ({
    AppendToolProvider: class { },
}));

import { TypeAUserProfileExtractor } from "../src/ai-services/memory-extraction/type-a-extractor";
import type { PersistedTurn } from "../src/chat/chat-history-store";

describe("TypeAUserProfileExtractor.extractCandidatesWithLLM", () => {
    const extractor = new TypeAUserProfileExtractor();
    const baseConversation = { id: "conv-1", title: "Test", createdAt: "2026-06-17", updatedAt: "2026-06-17", preview: "", turnCount: 2 };
    const turn = (text: string, withHostProvenance = true): PersistedTurn => ({
        conversationId: baseConversation.id, turnIndex: 0,
        user: { role: 'user', content: text, ...(withHostProvenance ? { hostProvenance: {
            version: 1 as const, messageId: 'user-0', kind: 'ordinary_user_statement' as const,
        } } : {}) },
        assistant: { role: 'assistant', content: 'Understood.' },
    });

    it("parses valid LLM response into candidates", async () => {
        const invoke = jest.fn(async (_prompt: string) => JSON.stringify({
            extractions: [
                { text: "User prefers concise answers", kind: "inferred_behavior", confidence: "medium", sourceMessageIds: ['user-0'] },
                { text: "User often asks about distributed systems", kind: "inferred_behavior", confidence: "high", sourceMessageIds: ['user-0'] },
            ],
        }));
        const turns = [turn('I prefer concise answers and often ask about distributed systems, including Raft consensus.')];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns },
            invoke,
        );
        expect(result.length).toBe(2);
        expect(result[0].kind).toBe("inferred_behavior");
        expect(result[1].confidence).toBe("high");
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(result[0].chatEvidence?.sources).toEqual([expect.objectContaining({ messageId: 'user-0', kind: 'ordinary_user_statement' })]);
    });

    it("falls back to regex on LLM failure", async () => {
        const invoke = async () => { throw new Error("API error"); };
        // Pre-B-129 turns have roles/conversation identity but no new provenance.
        const turns = [turn('I prefer simple explanations', false)];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns },
            invoke,
        );
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].kind).toBe("user_explicit");
    });

    it("falls back to regex when LLM returns malformed JSON", async () => {
        const invoke = async () => "not valid json at all";
        const turns = [turn('I prefer simple explanations.', false)];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns },
            invoke,
        );
        expect(result.length).toBeGreaterThan(0);
        expect(result[0]).toEqual(expect.objectContaining({
            kind: "user_explicit",
            text: "I prefer simple explanations.",
        }));
    });

    it("falls back to regex when LLM returns schema-invalid JSON", async () => {
        const invoke = async () => JSON.stringify({ findings: [] });
        const turns = [turn('I prefer simple explanations.', false)];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns },
            invoke,
        );
        expect(result).toEqual([expect.objectContaining({
            kind: "user_explicit",
            text: "I prefer simple explanations.",
        })]);
    });

    it("keeps a valid empty JSON response empty instead of falling back", async () => {
        const invoke = async () => JSON.stringify({ extractions: [] });
        const turns = [turn('I prefer simple explanations.', false)];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns },
            invoke,
        );
        expect(result).toEqual([]);
    });

    it("caps extractions at 5 items", async () => {
        const invoke = async () => JSON.stringify({
            extractions: Array.from({ length: 10 }, (_, i) => ({
                text: `preference ${i}`,
                kind: "inferred_behavior",
                confidence: "medium",
                sourceMessageIds: ['user-0'],
            })),
        });
        const turns = [turn('I prefer concise, evidence-backed explanations of distributed systems.')];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns },
            invoke,
        );
        expect(result).toHaveLength(5);
    });
});
