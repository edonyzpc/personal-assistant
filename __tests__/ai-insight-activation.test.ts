import { describe, expect, it, jest } from "@jest/globals";

jest.mock("vanilla-picker", () => ({
    __esModule: true,
    default: class {
        destroy = jest.fn();
        constructor(_options: unknown) { /* options ignored in tests */ }
    },
}));

jest.mock("../src/ai-services/append-tool-provider", () => ({
    AppendToolProvider: class { },
}));

import { expandByOneHop } from "../src/ai-services/pa-agent-runtime";
import { TypeAUserProfileExtractor } from "../src/ai-services/memory-extraction/type-a-extractor";
import type { MemoryCandidate } from "../src/ai-services/chat-types";

function makeCandidate(id: string, path: string, score: number): MemoryCandidate {
    return {
        candidateId: id,
        path,
        score,
        documents: [{
            content: `content of ${path}`,
            score,
            source: { path, score },
            anchorMetadata: {},
        }],
        excerpt: `excerpt of ${path}`,
    };
}

function makeRawChunk(path: string, score = 1) {
    return {
        score,
        doc: { pageContent: `chunk content of ${path}`, metadata: { path, chunkIndex: 0 } },
    };
}

describe("expandByOneHop", () => {
    it("returns original candidates when resolvedLinks is undefined", async () => {
        const candidates = [makeCandidate("c1", "notes/a.md", 0.9)];
        const result = await expandByOneHop(candidates, undefined);
        expect(result).toEqual(candidates);
    });

    it("expands top-3 candidates by outbound links", async () => {
        const candidates = [
            makeCandidate("c1", "notes/a.md", 0.9),
            makeCandidate("c2", "notes/b.md", 0.8),
        ];
        const links: Record<string, Record<string, number>> = {
            "notes/a.md": { "notes/c.md": 1, "notes/d.md": 1 },
        };
        const fetchChunks = jest.fn(async (paths: string[]) => paths.map((path) => makeRawChunk(path)));
        const result = await expandByOneHop(candidates, links, fetchChunks);
        expect(result.length).toBe(4);
        expect(result[2].path).toBe("notes/c.md");
        expect(result[3].path).toBe("notes/d.md");
        expect(result[2].score).toBe(0.9 * 0.5);
        expect(fetchChunks).toHaveBeenCalledTimes(1);
        expect(fetchChunks).toHaveBeenCalledWith(["notes/c.md", "notes/d.md"]);
    });

    it("skips already-present paths", async () => {
        const candidates = [makeCandidate("c1", "notes/a.md", 0.9)];
        const links: Record<string, Record<string, number>> = {
            "notes/a.md": { "notes/a.md": 1, "notes/b.md": 1 },
        };
        const fetchChunks = jest.fn(async (paths: string[]) => paths.map((path) => makeRawChunk(path)));
        const result = await expandByOneHop(candidates, links, fetchChunks);
        expect(result.length).toBe(2);
        expect(result[1].path).toBe("notes/b.md");
        expect(fetchChunks).toHaveBeenCalledWith(["notes/b.md"]);
    });

    it("limits to 2 expansions per candidate", async () => {
        const candidates = [makeCandidate("c1", "notes/a.md", 0.9)];
        const links: Record<string, Record<string, number>> = {
            "notes/a.md": { "notes/b.md": 1, "notes/c.md": 1, "notes/d.md": 1, "notes/e.md": 1 },
        };
        const fetchChunks = jest.fn(async (paths: string[]) => paths.map((path) => makeRawChunk(path)));
        const result = await expandByOneHop(candidates, links, fetchChunks);
        expect(result.length).toBe(3);
        expect(fetchChunks).toHaveBeenCalledWith(["notes/b.md", "notes/c.md"]);
    });

    it("uses fetchChunks to populate documents when provided", async () => {
        const candidates = [makeCandidate("c1", "notes/a.md", 0.9)];
        const links: Record<string, Record<string, number>> = {
            "notes/a.md": { "notes/b.md": 1 },
        };
        const fetchChunks = jest.fn(async (paths: string[]) => paths.map((path) => makeRawChunk(path, 0.7)));
        const result = await expandByOneHop(candidates, links, fetchChunks);
        expect(result.length).toBe(2);
        expect(result[1].documents.length).toBeGreaterThan(0);
        expect(result[1].excerpt).not.toContain("[linked from");
        expect(fetchChunks).toHaveBeenCalledWith(["notes/b.md"]);
    });

    it("does not append a candidate when exact lookup returns no chunks", async () => {
        const candidates = [makeCandidate("c1", "notes/a.md", 0.9)];
        const links: Record<string, Record<string, number>> = {
            "notes/a.md": { "notes/b.md": 1 },
        };
        const fetchChunks = jest.fn(async () => []);
        const result = await expandByOneHop(candidates, links, fetchChunks);
        expect(result).toEqual(candidates);
    });

    it("falls back gracefully when fetchChunks throws", async () => {
        const candidates = [makeCandidate("c1", "notes/a.md", 0.9)];
        const links: Record<string, Record<string, number>> = {
            "notes/a.md": { "notes/b.md": 1 },
        };
        const fetchChunks = async () => { throw new Error("worker error"); };
        const result = await expandByOneHop(candidates, links, fetchChunks);
        expect(result).toEqual(candidates);
    });

    it("expands inbound backlinks with 0.4 decay", async () => {
        const candidates = [makeCandidate("c1", "notes/a.md", 0.8)];
        const links: Record<string, Record<string, number>> = {
            "notes/hub.md": { "notes/a.md": 1 },
        };
        const fetchChunks = jest.fn(async (paths: string[]) => paths.map((path) => makeRawChunk(path)));
        const result = await expandByOneHop(candidates, links, fetchChunks);
        expect(result.length).toBe(2);
        expect(result[1].path).toBe("notes/hub.md");
        expect(result[1].score).toBe(0.8 * 0.4);
        expect(result[1].candidateId).toContain("backlink-");
    });

    it("expands both outbound and inbound links from the same parent", async () => {
        const candidates = [makeCandidate("c1", "notes/a.md", 0.9)];
        const links: Record<string, Record<string, number>> = {
            "notes/a.md": { "notes/outbound.md": 1 },
            "notes/inbound.md": { "notes/a.md": 1 },
        };
        const fetchChunks = jest.fn(async (paths: string[]) => paths.map((path) => makeRawChunk(path)));
        const result = await expandByOneHop(candidates, links, fetchChunks);
        expect(result.length).toBe(3);
        const outbound = result.find((c) => c.path === "notes/outbound.md");
        const inbound = result.find((c) => c.path === "notes/inbound.md");
        expect(outbound?.score).toBe(0.9 * 0.5);
        expect(inbound?.score).toBe(0.9 * 0.4);
        expect(outbound?.candidateId).toContain("link-");
        expect(inbound?.candidateId).toContain("backlink-");
    });

    it("does not duplicate paths between outbound and inbound expansions", async () => {
        const candidates = [makeCandidate("c1", "notes/a.md", 0.9)];
        const links: Record<string, Record<string, number>> = {
            "notes/a.md": { "notes/shared.md": 1 },
            "notes/shared.md": { "notes/a.md": 1 },
        };
        const fetchChunks = jest.fn(async (paths: string[]) => paths.map((path) => makeRawChunk(path)));
        const result = await expandByOneHop(candidates, links, fetchChunks);
        const sharedPaths = result.filter((c) => c.path === "notes/shared.md");
        expect(sharedPaths.length).toBe(1);
    });
});

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

    it("handles malformed JSON response gracefully", async () => {
        const invoke = async () => "not valid json at all";
        const turns = [{
            turnIndex: 0,
            user: { content: "hello" },
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
