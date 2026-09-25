import { describe, expect, it, jest } from "@jest/globals";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import { chatToolResultToAgentCapabilityResult } from "../src/ai-services/capability-adapter";
import {
    createInspectObsidianNoteTool,
    createQueryNotesTool,
    createReadNoteTool,
    createSearchVaultSnippetsTool,
} from "../src/ai-services/chat-tool-factories";
import type {
    ChatToolContext,
    ChatToolResult,
    InspectObsidianNoteOutput,
    QueryNotesOutput,
    ReadNoteOutput,
    VaultSnippetSearchOutput,
} from "../src/ai-services/chat-tool-types";
import {
    ChatHistoryManager,
} from "../src/chat/chat-history-manager";
import {
    MemoryChatHistoryStore,
} from "../src/chat/chat-history-store";
import type { HistoryTurnEntry } from "../src/chat/types";
import { readChatHistoryTurnMetadata } from "../src/ai-services/pa-agent-history";
import { parseVaultObservationEvidence } from "../src/ai-services/vault-observation-evidence";

jest.mock("obsidian");

jest.mock("../src/vss-helpers", () => ({
    computeContentHash: jest.fn(async (input: string) => {
        const { createHash } = jest.requireActual("node:crypto") as typeof import("node:crypto");
        return createHash("sha1").update(input, "utf8").digest("hex");
    }),
}));

type EvidenceCarrier = {
    vaultObservationEvidence?: unknown;
    vaultObservationContractVersion?: number;
    vaultObservationEvidenceInvalid?: boolean;
};

const HEX40 = /^[0-9a-f]{40}$/;

const carrier = (value: unknown): EvidenceCarrier => value as EvidenceCarrier;

function requireEvidence(value: unknown): EvidenceCarrier & {
    schemaVersion: number;
    tool: string;
    observationId: string;
    fingerprint: { algorithm: string; canonicalizationVersion: number };
    scope: { allowedPaths: string[] | null; excludedPaths: string[] };
    items: Array<Record<string, unknown>>;
    aggregate?: Record<string, unknown>;
} {
    const evidence = carrier(value).vaultObservationEvidence;
    expect(evidence).toBeDefined();
    expect(carrier(value).vaultObservationContractVersion).toBe(1);
    return evidence as EvidenceCarrier & {
        schemaVersion: number;
        tool: string;
        observationId: string;
        fingerprint: { algorithm: string; canonicalizationVersion: number };
        scope: { allowedPaths: string[] | null; excludedPaths: string[] };
        items: Array<Record<string, unknown>>;
        aggregate?: Record<string, unknown>;
    };
}

function makeReadFixture(content = "# Read source\nREAD_BODY_SENTINEL") {
    const file = {
        path: "notes/read.md",
        name: "read.md",
        basename: "read",
        extension: "md",
        stat: { ctime: 1, mtime: 2, size: content.length },
    };
    const cachedRead = jest.fn(async () => content);
    const host = {
        app: {
            vault: {
                getAbstractFileByPath: (path: string) => path === file.path ? file : null,
                cachedRead,
            },
            workspace: {
                getActiveViewOfType: () => ({
                    file: { path: "notes/active.md" },
                    editor: { getValue: () => "ACTIVE_EDITOR_SENTINEL" },
                }),
            },
        },
    } as unknown as AiServiceHost;
    const context: ChatToolContext = {
        host,
        taskSourceReadGuard: {
            isCurrent: () => true,
            isPathAllowed: (path: string) => path === file.path,
            getNoteSearchScope: () => ({
                allowedPaths: [file.path],
                excludedPaths: [],
            }),
        },
    };
    const tool = createReadNoteTool();
    return {
        tool,
        context,
        cachedRead,
        invoke: (raw: Record<string, unknown>) => tool.execute(tool.validateInput(raw), context),
    };
}

function makeQueryFixture(files: ReadonlyArray<{ path: string }>, caches: Record<string, unknown>) {
    const resolvedFiles = files.map((file, index) => ({
        path: file.path,
        name: file.path.split("/").pop(),
        basename: file.path.split("/").pop()?.replace(/\.md$/, ""),
        extension: "md",
        stat: { ctime: 1, mtime: index + 1, size: 20 },
    }));
    const cachedRead = jest.fn(async () => {
        throw new Error("query_notes must not read a body");
    });
    const host = {
        app: {
            vault: {
                getMarkdownFiles: () => resolvedFiles,
                cachedRead,
            },
            metadataCache: {
                getFileCache: (file: { path: string }) => caches[file.path] ?? null,
            },
        },
    } as unknown as AiServiceHost;
    const context: ChatToolContext = {
        host,
        taskSourceReadGuard: {
            isCurrent: () => true,
            isPathAllowed: () => true,
            getNoteSearchScope: () => ({ allowedPaths: null, excludedPaths: [] }),
        },
    };
    const tool = createQueryNotesTool();
    return {
        tool,
        context,
        cachedRead,
        invoke: (raw: Record<string, unknown>) => tool.execute(tool.validateInput(raw), context),
    };
}

function queryInput(properties: Array<Record<string, unknown>>) {
    return {
        properties,
        sort: { field: "path" as const, direction: "asc" as const },
        limit: 20,
    };
}

describe("T-07 host observation evidence contracts", () => {
    it("attaches a body-free, partition-bound read_note evidence envelope and passes it through the adapter", async () => {
        const fixture = makeReadFixture();
        const result = await fixture.invoke({ path: "notes/read.md" });
        expect(result.ok).toBe(true);
        const output = result.content as ReadNoteOutput;
        expect(output.text).toContain("READ_BODY_SENTINEL");

        const evidence = requireEvidence(result);
        expect(evidence.schemaVersion).toBe(1);
        expect(evidence.tool).toBe("read_note");
        expect(evidence.observationId).toEqual(expect.any(String));
        expect(evidence.fingerprint).toEqual({ algorithm: "sha1", canonicalizationVersion: 1 });
        expect(evidence.scope).toEqual({ allowedPaths: ["notes/read.md"], excludedPaths: [] });
        expect(evidence.items).toHaveLength(1);
        expect(evidence.items[0]).toMatchObject({
            kind: "read-result",
            path: "notes/read.md",
            part: output.part,
            range: output.range,
        });
        expect(String(evidence.items[0].contentHash)).toMatch(HEX40);
        expect(String(evidence.items[0].outputDigest)).toMatch(HEX40);
        expect(JSON.stringify(evidence)).not.toContain("READ_BODY_SENTINEL");
        expect(JSON.stringify(evidence)).not.toContain("ACTIVE_EDITOR_SENTINEL");

        const adapted = chatToolResultToAgentCapabilityResult(fixture.tool, "test-provider", result);
        expect(carrier(adapted).vaultObservationContractVersion).toBe(1);
        expect(carrier(adapted).vaultObservationEvidence).toEqual(evidence);
        expect(adapted.sourceRecords[0].observedRevision).toMatchObject({
            state: 'identified', basis: 'vault_read', digest: { scope: 'whole_file' },
        });
    });

    it.each([
        ["exact-zero", []],
        ["nonmatch-dependencies", [
            { path: "notes/match.md" },
            { path: "notes/nonmatch.md" },
        ]],
    ] as const)("attaches query aggregate evidence for %s even when visible sources are empty", async (_name, files) => {
        const fixture = makeQueryFixture(files, {
            "notes/match.md": { frontmatter: { status: "active" } },
            "notes/nonmatch.md": { frontmatter: { status: "inactive" } },
        });
        const result = await fixture.invoke(queryInput([
            { key: "status", operator: "equals", value: "active" },
        ]));
        expect(result.ok).toBe(true);
        const output = result.content as QueryNotesOutput;
        expect(fixture.cachedRead).not.toHaveBeenCalled();

        const evidence = requireEvidence(result);
        expect(evidence.tool).toBe("query_notes");
        expect(evidence.aggregate).toMatchObject({
            kind: "query",
            evaluatedCandidates: files.length,
            completeCandidateSet: true,
            projectionComplete: true,
        });
        expect(String(evidence.aggregate?.candidateSetDigest)).toMatch(HEX40);
        expect(String(evidence.aggregate?.metadataSetDigest)).toMatch(HEX40);
        expect(JSON.stringify(evidence)).not.toContain("notes/nonmatch.md\ninactive");

        const adapted = chatToolResultToAgentCapabilityResult(fixture.tool, "test-provider", result);
        expect(carrier(adapted).vaultObservationEvidence).toEqual(evidence);
        expect(carrier(adapted).vaultObservationContractVersion).toBe(1);
        if (files.length) expect(adapted.sourceRecords.find(record => !record.statusOnly)?.observedRevision)
            .toMatchObject({ state: 'identified', basis: 'metadata_snapshot',
                digest: { scope: 'metadata_projection' } });
    });

    it("marks successful snippets with the new host contract without copying snippet bodies", async () => {
        const content = "# Snippet\nSNIPPET_BODY_SENTINEL needle";
        const file = {
            path: "notes/snippet.md",
            basename: "snippet",
            stat: { mtime: 1, ctime: 1, size: content.length },
        };
        const host = {
            app: {
                vault: {
                    getMarkdownFiles: () => [file],
                    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
                    cachedRead: async () => content,
                },
                metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
            },
        } as unknown as AiServiceHost;
        const tool = createSearchVaultSnippetsTool();
        const result = await tool.execute(tool.validateInput({ query: "needle", limit: 5 }), { host });
        expect(result.ok).toBe(true);
        const output = result.content as VaultSnippetSearchOutput;
        expect(output.matches).toHaveLength(1);

        const evidence = requireEvidence(result);
        expect(evidence.tool).toBe("search_vault_snippets");
        expect(evidence.aggregate).toMatchObject({ kind: "snippets", query: "needle", evaluatedCandidates: 1 });
        expect(evidence.items[0]).toMatchObject({
            kind: "snippet-match",
            index: 0,
            path: "notes/snippet.md",
            part: output.matches[0].part,
            range: output.matches[0].range,
        });
        expect(JSON.stringify(evidence)).not.toContain("SNIPPET_BODY_SENTINEL");
        expect(chatToolResultToAgentCapabilityResult(tool, 'test-provider', result)
            .sourceRecords.find(record => !record.statusOnly)?.observedRevision).toMatchObject({
                state: 'identified', basis: 'vault_read', digest: { scope: 'snippet_projection' },
            });
    });

    it("marks cache-only inspect evidence with its actual structure and link dependencies", async () => {
        const file = { path: "notes/cache.md", basename: "cache", stat: { mtime: 1, size: 30 } };
        const cachedRead = jest.fn(async () => "INSPECT_BODY_SENTINEL");
        const host = {
            app: {
                vault: {
                    getMarkdownFiles: () => [file],
                    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
                    cachedRead,
                },
                metadataCache: {
                    getFileCache: () => ({
                        headings: [{ heading: "Cached heading", level: 2 }],
                        links: [],
                        embeds: [],
                        listItems: [],
                        sections: [],
                        blocks: {},
                    }),
                    resolvedLinks: { "notes/other.md": ["notes/cache.md"] },
                    unresolvedLinks: {},
                },
            },
        } as unknown as AiServiceHost;
        const tool = createInspectObsidianNoteTool();
        const result = await tool.execute(tool.validateInput({ path: "notes/cache.md" }), { host });
        expect(result.ok).toBe(true);
        const output = result.content as InspectObsidianNoteOutput;
        expect(cachedRead).not.toHaveBeenCalled();

        const evidence = requireEvidence(result);
        expect(evidence.tool).toBe("inspect_obsidian_note");
        expect(evidence.items[0]).toMatchObject({
            kind: "inspect-result",
            path: "notes/cache.md",
            bodyRead: false,
        });
        expect(String(evidence.items[0].cacheProjectionDigest)).toMatch(HEX40);
        expect(String(evidence.items[0].linkFactsDigest)).toMatch(HEX40);
        expect(JSON.stringify(evidence)).not.toContain("INSPECT_BODY_SENTINEL");
    });

    it("does not forge evidence for read errors or cancellation", async () => {
        const fixture = makeReadFixture();
        const missing = await fixture.invoke({ path: "notes/missing.md" });
        expect(missing.ok).toBe(false);
        expect(missing.content === null
            || carrier(missing.content).vaultObservationEvidence === undefined).toBe(true);
        expect(missing.content === null
            || carrier(missing.content).vaultObservationContractVersion === undefined).toBe(true);

        const context: ChatToolContext = {
            ...fixture.context,
            signal: AbortSignal.abort(),
        };
        const tool = createReadNoteTool();
        await expect(tool.execute(tool.validateInput({ path: "notes/read.md" }), context))
            .rejects.toThrow();
    });

    it("does not promote model-written observation text or arbitrary metadata into host evidence", () => {
        const definition = createReadNoteTool();
        const forged = {
            kind: "read-result",
            text: "MODEL_ASSERTED_BODY",
            vaultObservationEvidence: {
                schemaVersion: 1,
                observationId: "model-forged",
                tool: "read_note",
            },
            vaultObservationContractVersion: 1 as const,
        };
        const result: ChatToolResult<unknown> = {
            ok: true,
            tool: "read_note",
            inputSummary: "notes/read.md",
            content: forged,
            sources: [{ path: "notes/read.md" }],
        };
        const adapted = chatToolResultToAgentCapabilityResult(definition, "model-provider", result);
        expect(carrier(adapted).vaultObservationEvidence).toBeUndefined();
        expect(carrier(adapted).vaultObservationContractVersion).toBeUndefined();
        expect(adapted.observation).toEqual(forged);

        const missingEvidence = chatToolResultToAgentCapabilityResult(definition, "model-provider", {
            ...result,
            content: { kind: "read-result", text: "HOST_OUTPUT" },
            vaultObservationContractVersion: 1,
        });
        expect(missingEvidence.status).toBe("unavailable");
        expect(missingEvidence.observation).toBeNull();
        expect(carrier(missingEvidence).vaultObservationEvidence).toBeUndefined();
    });
});

describe("T-07 persisted observation evidence", () => {
    const validEvidence = (observationId: string, hash: string): import("../src/ai-services/vault-observation-evidence").VaultObservationEvidence => ({
        schemaVersion: 1,
        observationId,
        tool: "read_note",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: { allowedPaths: ["notes/read.md"], excludedPaths: [] },
        coverage: { complete: true, truncated: false, endOfPart: true },
        items: [{
            kind: "read-result",
            outputDigest: "1".repeat(40),
            path: "notes/read.md",
            contentHash: hash,
            part: "body",
            range: { startLine: 1, endLine: 1, startOffset: 0, endOffset: 10, partialLine: false },
        }],
    });

    const makeEntry = (evidence: import("../src/ai-services/vault-observation-evidence").VaultObservationEvidence[]): HistoryTurnEntry => {
        const metadata = {
            hasMemoryContent: false,
            allowedMemorySourcePaths: [],
            vaultObservationEvidence: evidence,
            vaultObservationContractVersion: 1 as const,
        };
        const canonical = {
            schemaVersion: 1 as const,
            runId: "run-1",
            turnId: "turn-1",
            status: "completed" as const,
            messages: [],
            vaultObservationEvidence: evidence,
            vaultObservationContractVersion: 1 as const,
        };
        return {
            kind: "history",
            user: { role: "user", content: "Read the note" },
            assistant: {
                role: "assistant",
                content: "A source-backed answer.",
                canonicalTurn: canonical,
                memoryMetadata: metadata,
            },
            memoryMetadata: metadata,
        };
    };

    const manager = () => new ChatHistoryManager({
        store: new MemoryChatHistoryStore(),
        now: () => new Date("2026-09-15T00:00:00.000Z"),
        generateId: () => "conversation",
    });

    it("persists same-path observations separately and restores independent nested clones", async () => {
        const first = validEvidence("obs-read-first", "a".repeat(40));
        const second = validEvidence("obs-read-second", "b".repeat(40));
        const store = new MemoryChatHistoryStore();
        const historyManager = new ChatHistoryManager({
            store,
            now: () => new Date("2026-09-15T00:00:00.000Z"),
            generateId: () => "conversation",
        });
        const serialized = historyManager.serializeTurn(makeEntry([first, second]), "conversation", 0);
        const persisted = serialized.memoryMetadata as EvidenceCarrier;
        expect(persisted.vaultObservationContractVersion).toBe(1);
        expect(persisted.vaultObservationEvidence).toEqual([first, second]);
        expect(JSON.stringify(serialized)).not.toContain("A source-backed answer with body log");

        await store.appendTurn(serialized);
        const saved = await store.getTurns("conversation");
        const restored = historyManager.deserializeTurn(saved[0]);
        const restoredAssistant = restored.assistantMessage;
        const assistantEvidence = carrier(restoredAssistant.memoryMetadata).vaultObservationEvidence as typeof first[];
        const historyEvidence = carrier(restored.historyEntry.memoryMetadata).vaultObservationEvidence as typeof first[];
        const canonicalEvidence = carrier(readChatHistoryTurnMetadata(restoredAssistant))
            .vaultObservationEvidence as typeof first[];
        expect(assistantEvidence.map(item => item.observationId)).toEqual(["obs-read-first", "obs-read-second"]);
        expect(historyEvidence).toEqual(assistantEvidence);
        expect(canonicalEvidence).toEqual(assistantEvidence);

        assistantEvidence[0]?.scope.allowedPaths?.push("polluted.md");
        expect(historyEvidence[0].scope.allowedPaths).toEqual(["notes/read.md"]);
        expect(canonicalEvidence[0].scope.allowedPaths).toEqual(["notes/read.md"]);
    });

    it("fails closed when a new-contract persisted envelope is malformed", async () => {
        const malformed = validEvidence("obs-malformed", "not-a-hash");
        (malformed as { rawText?: string }).rawText = "MALFORMED_PAYLOAD_SENTINEL";
        const serialized = manager().serializeTurn(makeEntry([malformed]), "conversation", 0);
        expect(carrier(serialized.memoryMetadata).vaultObservationContractVersion).toBe(1);
        expect(carrier(serialized.memoryMetadata).vaultObservationEvidenceInvalid).toBe(true);
        expect(carrier(serialized.memoryMetadata).vaultObservationEvidence).toEqual([]);
        expect(serialized.vaultObservationEvidence).toEqual([]);
        expect(JSON.stringify(serialized)).not.toContain("MALFORMED_PAYLOAD_SENTINEL");

        const store = new MemoryChatHistoryStore();
        await store.appendTurn(serialized);
        const [saved] = await store.getTurns("conversation");
        const restored = manager().deserializeTurn(saved);
        const restoredMetadata = readChatHistoryTurnMetadata(restored.assistantMessage);
        expect(carrier(restored.assistantMessage.memoryMetadata).vaultObservationEvidence).toEqual([]);
        expect(carrier(restored.assistantMessage.canonicalTurn).vaultObservationEvidence).toEqual([]);
        expect(carrier(restoredMetadata).vaultObservationEvidence).toEqual([]);
        expect(JSON.stringify(saved)).not.toContain("MALFORMED_PAYLOAD_SENTINEL");
    });

    it("keeps a missing evidence array explicitly unavailable instead of treating it as legacy", async () => {
        const entry = makeEntry([]);
        delete (entry.assistant.memoryMetadata as { vaultObservationEvidence?: unknown }).vaultObservationEvidence;
        delete entry.assistant.canonicalTurn!.vaultObservationEvidence;
        const serialized = manager().serializeTurn(entry, "conversation", 0);
        expect(carrier(serialized.memoryMetadata).vaultObservationContractVersion).toBe(1);
        expect(carrier(serialized.memoryMetadata).vaultObservationEvidenceInvalid).toBe(true);
        expect(carrier(serialized.memoryMetadata).vaultObservationEvidence).toEqual([]);

        const store = new MemoryChatHistoryStore();
        await store.appendTurn(serialized);
        const [saved] = await store.getTurns("conversation");
        const restored = manager().deserializeTurn(saved);
        expect(carrier(restored.assistantMessage.memoryMetadata).vaultObservationEvidenceInvalid).toBe(true);
        expect(carrier(restored.assistantMessage.canonicalTurn).vaultObservationEvidenceInvalid).toBe(true);
    });

    it("does not bypass the whole-turn evidence budget with 65 valid envelopes", () => {
        const evidence = Array.from({ length: 65 }, (_, index) => validEvidence(`obs-${index}`, `${index % 10}${index % 7}`.padEnd(40, "0").slice(0, 40)));
        const serialized = manager().serializeTurn(makeEntry(evidence), "conversation", 0);
        const persisted = carrier(serialized.memoryMetadata);
        expect(persisted.vaultObservationContractVersion).toBe(1);
        expect(persisted.vaultObservationEvidenceInvalid).toBe(true);
        expect(persisted.vaultObservationEvidence).toEqual([]);
    });

    it("does not bypass the whole-turn byte budget with several individually valid envelopes", () => {
        const longPaths = Array.from({ length: 400 }, (_, index) => `notes/${index}/${"x".repeat(220)}`);
        const evidence = Array.from({ length: 6 }, (_, index) => ({
            ...validEvidence(`obs-byte-${index}`, `${index}${"0".repeat(39)}`),
            scope: { allowedPaths: longPaths, excludedPaths: [] },
        }));
        evidence.forEach(item => expect(parseVaultObservationEvidence(item).ok).toBe(true));
        const serialized = manager().serializeTurn(makeEntry(evidence), "conversation", 0);
        expect(carrier(serialized.memoryMetadata).vaultObservationEvidenceInvalid).toBe(true);
        expect(carrier(serialized.memoryMetadata).vaultObservationEvidence).toEqual([]);
    });
});
