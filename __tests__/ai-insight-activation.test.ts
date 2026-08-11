import { describe, expect, it, jest } from "@jest/globals";

jest.mock("../src/ai-services/append-tool-provider", () => ({
    AppendToolProvider: class { },
}));

import { TypeAUserProfileExtractor } from "../src/ai-services/memory-extraction/type-a-extractor";

describe("TypeAUserProfileExtractor.extractCandidatesWithLLM", () => {
    const extractor = new TypeAUserProfileExtractor();
    const baseConversation = { id: "conv-1", title: "Test", createdAt: "2026-06-17", updatedAt: "2026-06-17", preview: "", turnCount: 2 };

    it("parses valid LLM response into candidates", async () => {
        const invoke = async () => JSON.stringify({
            extractions: [
                { text: "User prefers concise answers", kind: "inferred_behavior", confidence: "medium" },
                { text: "User always asks about distributed systems", kind: "inferred_behavior", confidence: "high" },
            ],
        });
        const turns = [{
            turnIndex: 0,
            user: { content: "Tell me about Raft consensus" },
            assistant: { content: "Raft is a consensus algorithm..." },
        }];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns: turns as any },
            invoke,
        );
        expect(result.length).toBe(2);
        expect(result[0].kind).toBe("inferred_behavior");
        expect(result[1].confidence).toBe("high");
    });

    it("falls back to regex on LLM failure", async () => {
        const invoke = async () => { throw new Error("API error"); };
        const turns = [{
            turnIndex: 0,
            user: { content: "I prefer simple explanations" },
            assistant: { content: "Sure!" },
        }];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns: turns as any },
            invoke,
        );
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].kind).toBe("user_explicit");
    });

    it("falls back to regex when LLM returns malformed JSON", async () => {
        const invoke = async () => "not valid json at all";
        const turns = [{
            turnIndex: 0,
            user: { content: "I prefer simple explanations." },
            assistant: { content: "hi" },
        }];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns: turns as any },
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
        const turns = [{
            turnIndex: 0,
            user: { content: "I prefer simple explanations." },
            assistant: { content: "hi" },
        }];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns: turns as any },
            invoke,
        );
        expect(result).toEqual([expect.objectContaining({
            kind: "user_explicit",
            text: "I prefer simple explanations.",
        })]);
    });

    it("keeps a valid empty JSON response empty instead of falling back", async () => {
        const invoke = async () => JSON.stringify({ extractions: [] });
        const turns = [{
            turnIndex: 0,
            user: { content: "I prefer simple explanations." },
            assistant: { content: "hi" },
        }];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns: turns as any },
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
            })),
        });
        const turns = [{
            turnIndex: 0,
            user: { content: "test" },
            assistant: { content: "reply" },
        }];
        const result = await extractor.extractCandidatesWithLLM(
            { conversation: baseConversation, turns: turns as any },
            invoke,
        );
        expect(result.length).toBeLessThanOrEqual(5);
    });
});
