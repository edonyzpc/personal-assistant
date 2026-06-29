import { describe, expect, it } from "@jest/globals";

import {
    createPaAgentPersistedTurn,
    extractCanonicalTurnMetadata,
    readChatHistoryTurnMetadata,
} from "../src/ai-services/pa-agent-history";
import {
    PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION,
    type ChatMessage,
    type ChatTurnMemoryMetadata,
    type PaAgentMessage,
} from "../src/ai-services/chat-types";

describe("PA Agent canonical history metadata", () => {
    it("persists canonical turns with an explicit schema version", () => {
        const messages = [createUserMessage()];

        const turn = createPaAgentPersistedTurn({
            runId: "run-1",
            turnId: "turn-1",
            status: "completed",
            committedFinalText: "answer",
            messages,
        });

        expect(turn).toMatchObject({
            schemaVersion: PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION,
            runId: "run-1",
            turnId: "turn-1",
            status: "completed",
            committedFinalText: "answer",
        });
        expect(turn.messages).toEqual(messages);
        expect(turn.messages).not.toBe(messages);
    });

    it("reconstructs source records and Context Used from canonical toolResult messages", () => {
        const canonicalTurn = createPaAgentPersistedTurn({
            runId: "run-1",
            turnId: "turn-1",
            messages: [
                createUserMessage(),
                createToolResultMessage("call-memory", "search_memory", {
                    sourceRecords: [{
                        kind: "memory-reference",
                        dedupKey: "memory:dog",
                        sourceBoundary: "memory",
                        path: "0.unsorted/Dog.md",
                        citationEligible: true,
                    }],
                    contextUsed: [{
                        category: "memory",
                        label: "Selected Memory",
                        sources: [{ path: "0.unsorted/Dog.md" }],
                        citationEligible: true,
                    }],
                }),
                createToolResultMessage("call-current", "get_current_note_context", {
                    sourceRecords: [{
                        kind: "context-used",
                        dedupKey: "current:note",
                        sourceBoundary: "current-note",
                        path: "notes/current.md",
                        citationEligible: false,
                    }],
                    contextUsed: [{
                        category: "current-note",
                        label: "Current note",
                        sources: [{ path: "notes/current.md" }],
                        citationEligible: false,
                    }],
                }),
            ],
        });

        const metadata = extractCanonicalTurnMetadata(canonicalTurn);

        expect(metadata).toEqual(expect.objectContaining({
            hasMemoryContent: true,
            allowedMemorySourcePaths: ["0.unsorted/Dog.md"],
            sourceRecords: [
                expect.objectContaining({ kind: "memory-reference", path: "0.unsorted/Dog.md" }),
                expect.objectContaining({ kind: "context-used", path: "notes/current.md" }),
            ],
            contextUsed: [
                expect.objectContaining({ category: "memory", label: "Selected Memory" }),
                expect.objectContaining({ category: "current-note", label: "Current note" }),
            ],
            contextTrace: expect.objectContaining({
                runId: "run-1",
                usedSourceCount: 1,
                usedMemoryCount: 1,
            }),
        }));
        expect(JSON.stringify(metadata.contextTrace)).not.toContain("observation");
    });

    it("reconstructs host pre-context source records and Context Used without toolResult messages", () => {
        const canonicalTurn = createPaAgentPersistedTurn({
            runId: "run-1",
            turnId: "turn-1",
            sourceRecords: [{
                kind: "skill-guide",
                dedupKey: "skill:pa-vault-link-health",
                sourceBoundary: "skill-context",
                title: "pa-vault-link-health",
                turnId: "turn-1",
                citationEligible: false,
                statusOnly: true,
            }, {
                kind: "skill-guide",
                dedupKey: "skill:pa-vault-link-health",
                sourceBoundary: "skill-context",
                title: "pa-vault-link-health",
                turnId: "turn-2",
                citationEligible: false,
                statusOnly: true,
            }],
            contextUsed: [{
                category: "skill-guide",
                label: "pa-vault-link-health",
                sources: [{ path: "skills/pa-vault-link-health/SKILL.md" }],
                citationEligible: false,
            }],
            messages: [
                createUserMessage(),
            ],
        });

        const metadata = extractCanonicalTurnMetadata(canonicalTurn);

        expect(metadata).toEqual(expect.objectContaining({
            hasMemoryContent: false,
            allowedMemorySourcePaths: [],
            sourceRecords: [expect.objectContaining({
                kind: "skill-guide",
                title: "pa-vault-link-health",
                turnId: "turn-1",
            })],
            contextUsed: [expect.objectContaining({
                category: "skill-guide",
                label: "pa-vault-link-health",
            })],
            contextTrace: expect.objectContaining({
                runId: "run-1",
                usedSourceCount: 1,
            }),
        }));
        expect(metadata.sourceRecords).toHaveLength(1);
        expect(canonicalTurn.sourceRecords?.[0]).not.toBe(metadata.sourceRecords?.[0]);
        expect(canonicalTurn.contextUsed?.[0]).not.toBe(metadata.contextUsed?.[0]);
    });

    it("dual-reads canonical metadata first and legacy metadata as fallback", () => {
        const legacyMetadata: ChatTurnMemoryMetadata = {
            hasMemoryContent: true,
            allowedMemorySourcePaths: ["legacy/memory.md"],
            sourceRecords: [{
                kind: "memory-reference",
                dedupKey: "legacy",
                sourceBoundary: "memory",
                path: "legacy/memory.md",
            }],
            contextUsed: [{
                category: "memory",
                label: "Legacy Memory",
                sources: [{ path: "legacy/memory.md" }],
                citationEligible: true,
            }],
        };
        const legacyMessage: ChatMessage = {
            role: "assistant",
            content: "legacy answer",
            memoryMetadata: legacyMetadata,
        };
        const canonicalMessage: ChatMessage = {
            role: "assistant",
            content: "canonical answer",
            memoryMetadata: legacyMetadata,
            canonicalTurn: createPaAgentPersistedTurn({
                runId: "run-1",
                turnId: "turn-1",
                messages: [
                    createToolResultMessage("call-web", "webSearch", {
                        sourceRecords: [{
                            kind: "web-source",
                            dedupKey: "web",
                            sourceBoundary: "web",
                            url: "https://example.com",
                            citationEligible: true,
                        }],
                        contextUsed: [{
                            category: "read-only-tool",
                            label: "WebSearch",
                            citationEligible: false,
                        }],
                    }),
                ],
            }),
        };

        expect(readChatHistoryTurnMetadata(legacyMessage)).toEqual(legacyMetadata);
        expect(readChatHistoryTurnMetadata(canonicalMessage)).toEqual({
            hasMemoryContent: false,
            allowedMemorySourcePaths: [],
            sourceRecords: [expect.objectContaining({ kind: "web-source", url: "https://example.com" })],
            contextUsed: [expect.objectContaining({ category: "read-only-tool", label: "WebSearch" })],
            contextTrace: expect.objectContaining({ runId: "run-1" }),
        });
    });

    it("preserves pre-refactor source chips and Context Used through legacy fallback", () => {
        const legacyEntryMetadata: ChatTurnMemoryMetadata = {
            hasMemoryContent: true,
            allowedMemorySourcePaths: ["notes/dog.md"],
            sourceRecords: [{
                kind: "memory-reference",
                dedupKey: "dog",
                sourceBoundary: "memory",
                path: "notes/dog.md",
                citationEligible: true,
            }],
            contextUsed: [{
                category: "current-note",
                label: "Current note",
                sources: [{ path: "notes/current.md" }],
                citationEligible: false,
            }],
        };
        const assistantMessage: ChatMessage = {
            role: "assistant",
            content: "pre-refactor answer",
        };

        const metadata = readChatHistoryTurnMetadata(assistantMessage, legacyEntryMetadata);

        expect(metadata).toEqual(legacyEntryMetadata);
        expect(metadata?.sourceRecords).toEqual([expect.objectContaining({
            kind: "memory-reference",
            path: "notes/dog.md",
        })]);
        expect(metadata?.contextUsed).toEqual([expect.objectContaining({
            category: "current-note",
            label: "Current note",
        })]);
    });
});

function createUserMessage(): PaAgentMessage {
    return {
        role: "user",
        id: "message-user",
        content: "question",
        timestamp: 1000,
    };
}

function createToolResultMessage(
    toolCallId: string,
    toolName: string,
    content: Pick<Extract<PaAgentMessage, { role: "toolResult" }>["content"], "sourceRecords" | "contextUsed">,
): PaAgentMessage {
    return {
        role: "toolResult",
        id: `message-${toolCallId}`,
        toolCallId,
        toolName,
        isError: false,
        timestamp: 1001,
        content: {
            promptText: "observation",
            includeInNextPrompt: true,
            ...content,
        },
    };
}
