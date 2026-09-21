import { describe, expect, it, jest } from "@jest/globals";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import {
    createReadNoteTool,
    createInspectObsidianNoteTool,
    createQueryNotesTool,
    createSearchVaultSnippetsTool,
} from "../src/ai-services/chat-tool-factories";
import type {
    ChatToolContext,
    ChatToolResult,
    InspectObsidianNoteOutput,
    QueryNotesOutput,
    VaultSnippetSearchOutput,
} from "../src/ai-services/chat-tool-types";
import type { ChatMessage, PaAgentMessage } from "../src/ai-services/chat-types";
import {
    MAX_VAULT_OBSERVATION_ENVELOPES_PER_TURN,
    assertVaultObservationHistory,
    cloneVaultObservationEvidence,
    hashObservationValue,
    parseVaultObservationEvidence,
    prepareVaultObservationProjection,
    revalidateVaultObservationFromApp,
    stableJson,
    type VaultObservationEvidence,
} from "../src/ai-services/vault-observation-evidence";
import { computeContentHash } from "../src/vss-helpers";

jest.mock("obsidian", () => {
    const base = jest.requireActual("../__mocks__/obsidian") as Record<string, unknown>;
    return {
        ...base,
        getAllTags: jest.fn((cache: {
            tags?: Array<{ tag?: string }>;
            frontmatter?: { tags?: unknown; tag?: unknown };
        }) => {
            const inline = (cache.tags ?? []).map(entry => entry.tag)
                .filter((tag): tag is string => typeof tag === "string");
            const frontmatterValue = cache.frontmatter?.tags;
            const frontmatterTags = Array.isArray(frontmatterValue)
                ? frontmatterValue.filter((tag): tag is string => typeof tag === "string")
                : typeof frontmatterValue === "string" ? [frontmatterValue] : [];
            return [...inline, ...frontmatterTags];
        }),
    };
});

jest.mock("../src/vss-helpers", () => ({
    computeContentHash: jest.fn(async (input: string) => {
        const { createHash } = jest.requireActual("node:crypto") as typeof import("node:crypto");
        return createHash("sha1").update(input, "utf8").digest("hex");
    }),
}));

interface FileFixture {
    path: string;
    name: string;
    basename: string;
    extension: string;
    stat: { ctime?: number; mtime?: number; size: number };
}

function makeFile(path: string, size = 20): FileFixture {
    const name = path.split("/").pop()!;
    return {
        path,
        name,
        basename: name.replace(/\.md$/, ""),
        extension: "md",
        stat: { ctime: 1, mtime: 2, size },
    };
}

function queryFixture(files: FileFixture[], caches: Map<string, unknown>, contents = new Map<string, string>()) {
    const getMarkdownFiles = jest.fn(() => files);
    const metadataCache = {
        caches,
        getFileCache: jest.fn(function getFileCache(this: { caches: Map<string, unknown> }, file: FileFixture) {
            return this.caches.get(file.path) ?? null;
        }),
    };
    const cachedRead = jest.fn(async (file: FileFixture) => {
        const value = contents.get(file.path);
        if (value === undefined) throw new Error("query_notes must not read a body");
        return value;
    });
    const host = {
        app: { vault: { getMarkdownFiles, cachedRead }, metadataCache },
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
        host,
        getMarkdownFiles,
        getFileCache: metadataCache.getFileCache,
        cachedRead,
        invoke: (raw: Record<string, unknown>) => tool.execute(tool.validateInput(raw), context),
    };
}

function requireQueryEvidence(
    result: ChatToolResult<QueryNotesOutput>,
): Extract<VaultObservationEvidence, { tool: "query_notes" }> {
    expect(result.ok).toBe(true);
    expect(result.vaultObservationContractVersion).toBe(1);
    const parsed = parseVaultObservationEvidence(result.vaultObservationEvidence);
    expect(parsed.ok).toBe(true);
    return (parsed as { ok: true; evidence: Extract<VaultObservationEvidence, { tool: "query_notes" }> }).evidence;
}

function queryMessage(result: ChatToolResult<QueryNotesOutput>): PaAgentMessage {
    return {
        role: "toolResult",
        id: "tool-result",
        toolCallId: "tool-call",
        toolName: "query_notes",
        isError: false,
        timestamp: 1,
        content: {
            promptText: JSON.stringify({
                tool: "query_notes",
                status: "ok",
                input: result.inputSummary,
                observation: result.content,
            }),
            includeInNextPrompt: true,
            metadata: {
                vaultObservationEvidence: result.vaultObservationEvidence,
                vaultObservationContractVersion: 1,
            },
        },
    };
}

function snippetMessage(result: ChatToolResult<VaultSnippetSearchOutput>): PaAgentMessage {
    return {
        role: "toolResult",
        id: "tool-result",
        toolCallId: "tool-call",
        toolName: "search_vault_snippets",
        isError: false,
        timestamp: 1,
        content: {
            promptText: JSON.stringify({
                tool: "search_vault_snippets",
                status: "ok",
                input: result.inputSummary,
                observation: result.content,
            }),
            includeInNextPrompt: true,
            metadata: {
                vaultObservationEvidence: result.vaultObservationEvidence,
                vaultObservationContractVersion: 1,
            },
        },
    };
}

function toolResultContent(message: PaAgentMessage) {
    expect(message.role).toBe("toolResult");
    return (message as Extract<PaAgentMessage, { role: "toolResult" }>).content;
}

describe("T-07 query evidence foundation", () => {
    it("revalidates unchanged producer evidence, including a date property, without adding instance identity", async () => {
        const caches = new Map([
            ["notes/a.md", { frontmatter: { status: "active", due: "2026-09-01" } }],
            ["notes/b.md", { frontmatter: { status: "active", due: "2026-09-02" } }],
        ]);
        const fixture = queryFixture([makeFile("notes/a.md"), makeFile("notes/b.md")], caches);
        const result = await fixture.invoke({
            properties: [{ key: "status", operator: "equals", value: "active" }],
            date: { field: "property", property: "due", kind: "calendar-date", from: "2026-09-01", to: "2026-09-03" },
            sort: { field: "path", direction: "asc" },
            limit: 20,
        });
        const evidence = requireQueryEvidence(result);
        expect(evidence.items.map(item => item.outputDigest))
            .toEqual(await Promise.all(result.content!.matches.map(match => hashObservationValue(match))));
        expect(JSON.stringify(evidence)).not.toContain('"identity"');
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
            .resolves.toEqual({ observationId: evidence.observationId, validItemIndexes: [0, 1], aggregateCurrent: true });

        caches.set("notes/a.md", { frontmatter: { status: "active", due: "2026-09-02" } });
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
            .resolves.toEqual({ observationId: evidence.observationId, validItemIndexes: [1], aggregateCurrent: false });
    });

    it("covers the permitted candidate set beyond the 500 evaluated cap without extra metadata reads", async () => {
        const files = Array.from({ length: 501 }, (_, index) => makeFile(`${String(index).padStart(3, "0")}.md`));
        const caches = new Map(files.map((file, index) => [file.path, { frontmatter: { index } }]));
        const fixture = queryFixture(files, caches);
        const result = await fixture.invoke({
            properties: [{ key: "index", operator: "exists" }],
            sort: { field: "path", direction: "asc" },
            limit: 20,
        });
        const evidence = requireQueryEvidence(result);
        expect(evidence.coverage).toMatchObject({ state: "partial", candidateCapExceeded: true });
        expect(evidence.aggregate.evaluatedCandidates).toBe(500);
        const producerCacheReads = fixture.getFileCache.mock.calls.length;
        expect(producerCacheReads).toBe(500);
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
            .resolves.toMatchObject({ aggregateCurrent: true, validItemIndexes: expect.any(Array) });
        expect(fixture.getFileCache.mock.calls.length).toBe(producerCacheReads + 500);
        expect(fixture.cachedRead).not.toHaveBeenCalled();
    });

    it.each([1_000, 1_024])(
        "uses one complete snapshot budget for producer and pure query revalidation at %d-char values",
        async (valueLength) => {
        const files = Array.from({ length: 500 }, (_, index) => makeFile(`${String(index).padStart(3, "0")}.md`));
        const caches = new Map(files.map(file => [file.path, { frontmatter: { p: "x".repeat(valueLength) } }]));
        const fixture = queryFixture(files, caches);
        const result = await fixture.invoke({
            properties: [{ key: "p", operator: "contains", value: "x" }],
            limit: 10,
        });
        const evidence = requireQueryEvidence(result);
        expect(evidence.coverage).toMatchObject({ state: "partial", projectionBudgetExceeded: true });
        expect(evidence.aggregate.evaluatedCandidates).toBe(valueLength === 1_000 ? 113 : 111);
        expect(evidence.items.map(item => item.path)).toEqual(files.slice(0, 10).map(file => file.path));
        const producerCacheReads = fixture.getFileCache.mock.calls.length;
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
            .resolves.toMatchObject({
                aggregateCurrent: true,
                validItemIndexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
            });
        expect(fixture.getFileCache.mock.calls.length).toBe(producerCacheReads * 2);
        expect(fixture.cachedRead).not.toHaveBeenCalled();
    });

    it("keeps fixed-width identities from changing small complete query budgets", async () => {
        for (const count of [9, 10, 99, 100]) {
            const files = Array.from({ length: count }, (_, index) => makeFile(`${String(index).padStart(3, "0")}.md`));
            const caches = new Map(files.map(file => [file.path, { frontmatter: { p: "x" } }]));
            const fixture = queryFixture(files, caches);
            const result = await fixture.invoke({
                properties: [{ key: "p", operator: "exists" }],
                limit: count,
            });
            const evidence = requireQueryEvidence(result);
            expect(evidence.coverage.state).toBe("complete");
            expect(evidence.aggregate.evaluatedCandidates).toBe(count);
            await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
                .resolves.toMatchObject({ aggregateCurrent: true });
        }
    });

    it("requires a current aggregate for a bound partial history payload", async () => {
        const files = Array.from({ length: 500 }, (_, index) => makeFile(`${String(index).padStart(3, "0")}.md`));
        const caches = new Map(files.map(file => [file.path, { frontmatter: { p: "x".repeat(1024) } }]));
        const fixture = queryFixture(files, caches);
        const result = await fixture.invoke({
            properties: [{ key: "p", operator: "contains", value: "x" }],
            limit: 1,
        });
        const evidence = requireQueryEvidence(result);
        expect(evidence.coverage.state).toBe("partial");
        const historyMessage: ChatMessage = {
            role: "assistant",
            content: "PARTIAL_HISTORY_SENTINEL",
            memoryMetadata: {
                hasMemoryContent: false,
                allowedMemorySourcePaths: [],
                vaultObservationEvidence: [evidence],
                vaultObservationContractVersion: 1,
            },
        };
        const projection = await prepareVaultObservationProjection({
            transcript: [],
            history: [historyMessage],
            revalidate: observation => revalidateVaultObservationFromApp(fixture.host, observation),
            getEpoch: () => "epoch-fixed",
        });
        expect(projection.history).toHaveLength(1);
        await projection.binding.prepare();
        projection.binding.assertCurrent();

        caches.set("001.md", { frontmatter: { p: "changed-but-unshown" } });
        await expect(projection.binding.prepare()).rejects.toThrow("changed before dispatch");
    });

    it("reads metadata cache only when query fields require it", async () => {
        const fixture = queryFixture([makeFile("notes/stat.md")], new Map());
        const result = await fixture.invoke({ sort: { field: "mtime", direction: "desc" }, limit: 10 });
        const evidence = requireQueryEvidence(result);
        expect(fixture.getFileCache).not.toHaveBeenCalled();
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
            .resolves.toMatchObject({ aggregateCurrent: true });
        expect(fixture.getFileCache).not.toHaveBeenCalled();
    });

    it("fails closed when a required query metadata API is unavailable", async () => {
        const donor = queryFixture([makeFile("notes/cache.md")], new Map([
            ["notes/cache.md", { frontmatter: { p: "x" } }],
        ]));
        const result = await donor.invoke({ properties: [{ key: "p", operator: "exists" }] });
        const evidence = requireQueryEvidence(result);
        const emptyFixture = queryFixture([], new Map());
        (emptyFixture.host.app as { metadataCache?: unknown }).metadataCache = undefined;
        await expect(emptyFixture.invoke({ properties: [{ key: "p", operator: "exists" }] }))
            .resolves.toMatchObject({ ok: false, error: "MetadataCache getFileCache is unavailable." });
        await expect(revalidateVaultObservationFromApp(emptyFixture.host, evidence))
            .rejects.toThrow("MetadataCache getFileCache is unavailable");
        const missingCacheHost = {
            app: { vault: donor.host.app.vault },
        } as unknown as AiServiceHost;
        await expect(revalidateVaultObservationFromApp(missingCacheHost, evidence))
            .rejects.toThrow("MetadataCache getFileCache is unavailable");
        await expect(revalidateVaultObservationFromApp(missingCacheHost, evidence, {
            isPathAllowed: () => false,
        }))
            .rejects.toThrow("MetadataCache getFileCache is unavailable");
    });

    it("does not turn missing vault enumeration into an empty successful query", async () => {
        const fixture = queryFixture([], new Map());
        (fixture.host.app.vault as { getMarkdownFiles?: unknown }).getMarkdownFiles = undefined;
        const result = await fixture.invoke({
            sort: { field: "path", direction: "asc" },
            limit: 20,
        }).catch(() => undefined);
        expect(result?.ok).not.toBe(true);
    });

    it("preserves an unchanged exact query and selectively retains B after A changes", async () => {
        const caches = new Map([
            ["notes/a.md", { frontmatter: { status: "active" } }],
            ["notes/b.md", { frontmatter: { status: "active" } }],
            ["notes/c.md", { frontmatter: { status: "active" } }],
        ]);
        const files = ["notes/a.md", "notes/b.md", "notes/c.md"].map(path => makeFile(path));
        const fixture = queryFixture(files, caches);
        const result = await fixture.invoke({
            properties: [{ key: "status", operator: "equals", value: "active" }],
            sort: { field: "path", direction: "asc" },
            limit: 2,
        });
        expect(result.ok).toBe(true);
        expect(result.content!.matches.map(match => match.path)).toEqual(["notes/a.md", "notes/b.md"]);
        const originalPrompt = JSON.stringify(result.content);
        let message = queryMessage(result);
        let epoch = "epoch-1";
        let revalidationCalls = 0;
        let projection = await prepareVaultObservationProjection({
            transcript: [message],
            history: [],
            revalidate: evidence => {
                revalidationCalls += 1;
                return revalidateVaultObservationFromApp(fixture.host, evidence);
            },
            getEpoch: () => epoch,
        });
        expect(toolResultContent(projection.transcript[0]!).promptText).toContain(originalPrompt);
        await projection.binding.prepare();
        expect(revalidationCalls).toBe(2);

        toolResultContent(projection.transcript[0]!).promptText = JSON.stringify({
            tool: "query_notes",
            status: "ok",
            observation: { matches: [{ path: "notes/late.md" }] },
        });
        await expect(projection.binding.prepare()).rejects.toThrow("changed before dispatch");

        caches.set("notes/a.md", { frontmatter: { status: "inactive" } });
        message = queryMessage(result);
        projection = await prepareVaultObservationProjection({
            transcript: [message],
            history: [],
            revalidate: evidence => revalidateVaultObservationFromApp(fixture.host, evidence),
            getEpoch: () => epoch,
        });
        const projected = JSON.parse(toolResultContent(projection.transcript[0]!).promptText) as {
            observation: QueryNotesOutput;
        };
        expect(projected.observation.matches.map(match => match.path)).toEqual(["notes/b.md"]);
        expect(projected.observation.nextCursor).toBeUndefined();
        expect(projected.observation.matchCountKind).toBe("lower-bound");
        expect(projected.observation.sort).toBeUndefined();
        expect(projected.observation.coverage).toEqual({ state: "partial" });
        expect(projected.observation.coverage.scannedPermittedNotes).toBeUndefined();
        expect(projected.observation.coverage.evaluatedCandidates).toBeUndefined();
        const projectedEvidence = parseVaultObservationEvidence(
            (projection.transcript[0] as Extract<PaAgentMessage, { role: "toolResult" }>).content.metadata!
                .vaultObservationEvidence,
        );
        if (!projectedEvidence.ok) throw new Error(projectedEvidence.reason);
        expect(projectedEvidence.evidence.items).toHaveLength(1);
        expect(projectedEvidence.evidence.items[0]).toMatchObject({ index: 0, path: "notes/b.md" });
        expect(projectedEvidence.evidence.items[0].outputDigest)
            .toBe(await hashObservationValue(projected.observation.matches[0]));
        await projection.binding.prepare();
        projection.binding.assertCurrent();
        epoch = "epoch-2";
        await projection.binding.prepare();
        projection.binding.assertCurrent();
        epoch = "epoch-3";
        expect(() => projection.binding.assertCurrent()).toThrow("changed before dispatch");

        const historyMessage: ChatMessage = {
            role: "assistant",
            content: "HISTORY_B_SENTINEL",
            memoryMetadata: {
                hasMemoryContent: false,
                allowedMemorySourcePaths: [],
                vaultObservationEvidence: [projectedEvidence.evidence],
                vaultObservationContractVersion: 1,
            },
        };
        const historyProjection = await prepareVaultObservationProjection({
            transcript: [],
            history: [historyMessage],
            revalidate: evidence => revalidateVaultObservationFromApp(fixture.host, evidence),
            getEpoch: () => "epoch-history",
        });
        expect(historyProjection.history).toEqual([]);
    });

    it("keeps a read snapshot across later vault edits but rejects a later path revocation", async () => {
        const caches = new Map([
            ["notes/a.md", { frontmatter: { status: "active" } }],
            ["notes/b.md", { frontmatter: { status: "active" } }],
        ]);
        const fixture = queryFixture(
            [makeFile("notes/a.md"), makeFile("notes/b.md")],
            caches,
        );
        const result = await fixture.invoke({
            properties: [{ key: "status", operator: "equals", value: "active" }],
            sort: { field: "path", direction: "asc" },
            limit: 2,
        });
        let allowed = true;
        const revalidate = jest.fn(async () => {
            throw new Error("read snapshots must not be refreshed");
        });
        const projection = await prepareVaultObservationProjection({
            transcript: [queryMessage(result)],
            history: [],
            revalidate,
            isPathAllowed: () => allowed,
            validationMode: "read_snapshot",
        });

        caches.set("notes/a.md", { frontmatter: { status: "inactive" } });
        await projection.binding.prepare();
        projection.binding.assertCurrent();
        expect(revalidate).not.toHaveBeenCalled();
        const projected = JSON.parse(toolResultContent(projection.transcript[0]!).promptText) as {
            observation: QueryNotesOutput;
        };
        expect(projected.observation.matches.map((match) => match.path)).toEqual([
            "notes/a.md",
            "notes/b.md",
        ]);

        allowed = false;
        await expect(projection.binding.prepare()).rejects.toThrow("authorization changed before dispatch");
        expect(() => projection.binding.assertCurrent()).toThrow("authorization changed before dispatch");
    });

    it("rejects physical admission after an exact-zero query aggregate changes", async () => {
        const caches = new Map([["notes/empty.md", { frontmatter: { status: "inactive" } }]]);
        const fixture = queryFixture([makeFile("notes/empty.md")], caches);
        const result = await fixture.invoke({
            properties: [{ key: "status", operator: "equals", value: "active" }],
            sort: { field: "path", direction: "asc" },
            limit: 20,
        });
        expect(result.content!.matches).toEqual([]);
        caches.set("notes/empty.md", { frontmatter: { status: "active" } });
        const projection = await prepareVaultObservationProjection({
            transcript: [queryMessage(result)],
            history: [],
            revalidate: evidence => revalidateVaultObservationFromApp(fixture.host, evidence),
            getEpoch: () => "epoch-1",
        });
        expect(JSON.parse(toolResultContent(projection.transcript[0]!).promptText)).toMatchObject({
            status: "unavailable",
        });
        await expect(projection.binding.prepare()).rejects.toThrow("changed before dispatch");
    });

    it("does not require an epoch or revalidation when legacy material has no observation contract", async () => {
        const projection = await prepareVaultObservationProjection({
            transcript: [{ role: "user", id: "user", content: "legacy", timestamp: 1 }],
            history: [],
            revalidate: () => {
                throw new Error("legacy material must not be revalidated");
            },
        });
        expect(projection.hasContractMaterial).toBe(false);
        await projection.binding.prepare();
    });

    it("withdraws a derived history message when a new-contract evidence array is missing", async () => {
        const projection = await prepareVaultObservationProjection({
            transcript: [],
            history: [{
                role: "assistant",
                content: "DERIVED_HISTORY_SENTINEL",
                memoryMetadata: {
                    hasMemoryContent: false,
                    allowedMemorySourcePaths: [],
                    vaultObservationContractVersion: 1,
                },
            }],
            revalidate: () => {
                throw new Error("missing evidence must not be treated as a valid empty array");
            },
            getEpoch: () => "epoch-1",
        });
        expect(projection.history).toEqual([]);
    });

    it("rejects a malformed query aggregate instead of accepting arbitrary nested metadata", () => {
        const files = [makeFile("notes/a.md")];
        const caches = new Map([["notes/a.md", { frontmatter: { status: "active" } }]]);
        const fixture = queryFixture(files, caches);
        return fixture.invoke({
            properties: [{ key: "status", operator: "equals", value: "active" }],
            sort: { field: "path", direction: "asc" },
            limit: 20,
        }).then(result => {
            const evidence = requireQueryEvidence(result) as unknown as Record<string, unknown>;
            const aggregate = evidence.aggregate as Record<string, unknown>;
            aggregate.query = { ...(aggregate.query as object), evil: "x".repeat(200_000) };
            expect(parseVaultObservationEvidence(evidence).ok).toBe(false);
        });
    });
});

describe("T-07 read evidence foundation", () => {
    it("binds the actual body and properties partition and detects same-stat content change", async () => {
        const file = makeFile("notes/read.md", 100);
        let content = "---\nstatus: active\n---\nBODY_SENTINEL";
        const host = {
            app: {
                vault: {
                    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
                    cachedRead: async () => content,
                },
            },
        } as unknown as AiServiceHost;
        const context: ChatToolContext = {
            host,
            taskSourceReadGuard: {
                isCurrent: () => true,
                isPathAllowed: () => true,
                getNoteSearchScope: () => ({ allowedPaths: [file.path], excludedPaths: [] }),
            },
        };
        const tool = createReadNoteTool();
        const body = await tool.execute(tool.validateInput({ path: file.path, part: "body" }), context);
        expect(body.ok).toBe(true);
        expect(body.content!.text).toContain("BODY_SENTINEL");
        const bodyEvidence = parseVaultObservationEvidence(body.vaultObservationEvidence);
        if (!bodyEvidence.ok) throw new Error(bodyEvidence.reason);
        expect(bodyEvidence.evidence.items[0].outputDigest).toBe(await hashObservationValue(body.content));
        await expect(revalidateVaultObservationFromApp(host, bodyEvidence.evidence))
            .resolves.toMatchObject({ validItemIndexes: [0], aggregateCurrent: true });

        const properties = await tool.execute(tool.validateInput({ path: file.path, part: "properties" }), context);
        expect(properties.ok).toBe(true);
        expect(properties.content!.text).toContain("status: active");
        const propertiesEvidence = parseVaultObservationEvidence(properties.vaultObservationEvidence);
        if (!propertiesEvidence.ok) throw new Error(propertiesEvidence.reason);
        await expect(revalidateVaultObservationFromApp(host, propertiesEvidence.evidence))
            .resolves.toMatchObject({ validItemIndexes: [0], aggregateCurrent: true });

        content = "---\nstatus: changed\n---\nCHANGED_BODY";
        await expect(revalidateVaultObservationFromApp(host, bodyEvidence.evidence))
            .resolves.toMatchObject({ validItemIndexes: [], aggregateCurrent: false });
        await expect(revalidateVaultObservationFromApp(host, propertiesEvidence.evidence))
            .resolves.toMatchObject({ validItemIndexes: [], aggregateCurrent: false });
    });
});

function snippetFixture(files: FileFixture[], contents: Map<string, string>) {
    const getMarkdownFiles = jest.fn(() => files);
    const getAbstractFileByPath = jest.fn((path: string) => files.find(file => file.path === path) ?? null);
    const cachedRead = jest.fn(async (file: FileFixture) => contents.get(file.path) ?? "");
    const host = {
        app: {
            vault: { getMarkdownFiles, getAbstractFileByPath, cachedRead },
            metadataCache: { getFileCache: () => null, resolvedLinks: {}, unresolvedLinks: {} },
        },
    } as unknown as AiServiceHost;
    const tool = createSearchVaultSnippetsTool();
    return {
        tool,
        host,
        cachedRead,
        invoke: (raw: Record<string, unknown>) => tool.execute(tool.validateInput(raw), { host }),
    };
}

function requireSnippetEvidence(result: ChatToolResult<VaultSnippetSearchOutput>): VaultObservationEvidence {
    expect(result.ok).toBe(true);
    const parsed = parseVaultObservationEvidence(result.vaultObservationEvidence);
    expect(parsed.ok).toBe(true);
    return (parsed as { ok: true; evidence: VaultObservationEvidence }).evidence;
}

describe("T-07 snippet evidence foundation", () => {
    it("keeps an unchanged empty scan and revokes exact-zero after a same-stat new match", async () => {
        const file = makeFile("notes/empty.md", 20);
        const contents = new Map([["notes/empty.md", "# Empty\nno match"]]);
        const fixture = snippetFixture([file], contents);
        const result = await fixture.invoke({ query: "needle", limit: 5 });
        const evidence = requireSnippetEvidence(result);
        expect(evidence.items).toEqual([]);
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
            .resolves.toEqual({ observationId: evidence.observationId, validItemIndexes: [], aggregateCurrent: true });

        contents.set("notes/empty.md", "# Empty\nneedle match");
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
            .resolves.toEqual({ observationId: evidence.observationId, validItemIndexes: [], aggregateCurrent: false });
    });

    it("independently rescans versions and retains only a still-current match", async () => {
        const files = [makeFile("notes/a.md", 30), makeFile("notes/b.md", 30)];
        const contents = new Map([
            ["notes/a.md", "# A\nneedle"],
            ["notes/b.md", "# B\nneedle"],
        ]);
        const fixture = snippetFixture(files, contents);
        const result = await fixture.invoke({ query: "needle", limit: 5 });
        const evidence = requireSnippetEvidence(result);
        expect(evidence.items.map(item => item.outputDigest))
            .toEqual(await Promise.all(result.content!.matches.map(match => hashObservationValue(match))));
        expect(evidence.items.map(item => item.path)).toEqual(["notes/a.md", "notes/b.md"]);
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
            .resolves.toEqual({ observationId: evidence.observationId, validItemIndexes: [0, 1], aggregateCurrent: true });

        contents.set("notes/a.md", "# A\nchanged");
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence))
            .resolves.toEqual({ observationId: evidence.observationId, validItemIndexes: [1], aggregateCurrent: false });
    });

    it("classifies known oversized and unknown file sizes identically during pure snippet revalidation", async () => {
        const oversized = makeFile("notes/big.md");
        oversized.stat = { size: 10_000_000 };
        const oversizedFixture = snippetFixture([oversized], new Map([["notes/big.md", "needle"]]));
        const oversizedResult = await oversizedFixture.invoke({ query: "needle", limit: 5 });
        expect(oversizedResult.content!.coverage).toMatchObject({ state: "partial", skippedFiles: 1 });
        const oversizedEvidence = requireSnippetEvidence(oversizedResult);
        await expect(revalidateVaultObservationFromApp(oversizedFixture.host, oversizedEvidence))
            .resolves.toMatchObject({ validItemIndexes: [], aggregateCurrent: true });
        expect(oversizedFixture.cachedRead).not.toHaveBeenCalled();

        const unknown = makeFile("notes/unknown.md");
        unknown.stat = { size: 10 };
        const unknownFixture = snippetFixture([unknown], new Map([["notes/unknown.md", "needle"]]));
        const unknownResult = await unknownFixture.invoke({ query: "needle", limit: 5 });
        expect(unknownResult.content!.coverage).toMatchObject({ state: "partial", unknownFileSize: true });
        const unknownEvidence = requireSnippetEvidence(unknownResult);
        await expect(revalidateVaultObservationFromApp(unknownFixture.host, unknownEvidence))
            .resolves.toMatchObject({ validItemIndexes: [], aggregateCurrent: true });
        expect(unknownFixture.cachedRead).not.toHaveBeenCalled();
    });

    it("rejects physical admission after an exact-zero snippet aggregate changes", async () => {
        const file = makeFile("notes/empty.md", 20);
        const fixture = snippetFixture([file], new Map([["notes/empty.md", "# Empty\nno match"]]));
        const result = await fixture.invoke({ query: "needle", limit: 5 });
        expect(result.content!.matches).toEqual([]);
        const contents = new Map([["notes/empty.md", "# Empty\nneedle match"]]);
        fixture.cachedRead.mockImplementation(async file => contents.get((file as { path: string }).path) ?? "");
        const projection = await prepareVaultObservationProjection({
            transcript: [snippetMessage(result)],
            history: [],
            revalidate: evidence => revalidateVaultObservationFromApp(fixture.host, evidence),
            getEpoch: () => "epoch-1",
        });
        expect(JSON.parse(toolResultContent(projection.transcript[0]!).promptText)).toMatchObject({
            status: "unavailable",
        });
        await expect(projection.binding.prepare()).rejects.toThrow("changed before dispatch");
    });

    it("rebinds a retained snippet to its actual projected output without inventing scan facts", async () => {
        const files = [makeFile("notes/a.md", 30), makeFile("notes/b.md", 30)];
        const contents = new Map([
            ["notes/a.md", "# A\nneedle"],
            ["notes/b.md", "# B\nneedle"],
        ]);
        const fixture = snippetFixture(files, contents);
        const result = await fixture.invoke({ query: "needle", limit: 5 });
        contents.set("notes/a.md", "# A\nchanged");
        const projection = await prepareVaultObservationProjection({
            transcript: [snippetMessage(result)],
            history: [],
            revalidate: evidence => revalidateVaultObservationFromApp(fixture.host, evidence),
            getEpoch: () => "epoch-1",
        });
        const projected = JSON.parse(toolResultContent(projection.transcript[0]!).promptText) as {
            observation: VaultSnippetSearchOutput;
        };
        expect(projected.observation.matches.map(match => match.path)).toEqual(["notes/b.md"]);
        expect(projected.observation.nextCursor).toBeUndefined();
        expect(projected.observation.matchCountKind).toBe("lower-bound");
        expect(projected.observation.page).toBeUndefined();
        expect(projected.observation.coverage).toEqual({ state: "partial" });
        expect(projected.observation.scannedFiles).toBeUndefined();
        expect(projected.observation.scannedBytes).toBeUndefined();
        expect(projected.observation.consideredFiles).toBeUndefined();
        expect(projected.observation.skippedSources).toBeUndefined();
        expect(projected.observation.omittedCount).toBeUndefined();
        const projectedEvidence = parseVaultObservationEvidence(
            (projection.transcript[0] as Extract<PaAgentMessage, { role: "toolResult" }>).content.metadata!
                .vaultObservationEvidence,
        );
        if (!projectedEvidence.ok) throw new Error(projectedEvidence.reason);
        expect(projectedEvidence.evidence.items[0]).toMatchObject({ index: 0, path: "notes/b.md" });
        expect(projectedEvidence.evidence.items[0].outputDigest)
            .toBe(await hashObservationValue(projected.observation.matches[0]));
        await projection.binding.prepare();
        projection.binding.assertCurrent();
    });

    it("withdraws aggregate facts from a real partial before binding retained snippets", async () => {
        const files = [
            makeFile("notes/a.md", 30),
            makeFile("notes/b.md", 30),
            makeFile("notes/c.md", 600_001),
        ];
        const contents = new Map([
            ["notes/a.md", "# A\nneedle"],
            ["notes/b.md", "# B\nneedle"],
            ["notes/c.md", `# C\n${"x".repeat(600_000)}`],
        ]);
        const fixture = snippetFixture(files, contents);
        const result = await fixture.invoke({ query: "needle", limit: 5 });
        expect(result.content!.coverage.state).toBe("partial");
        const originalPrompt = JSON.stringify({
            tool: "search_vault_snippets",
            status: "ok",
            observation: result.content,
        });
        contents.set("notes/a.md", "# A\nchanged");
        const projection = await prepareVaultObservationProjection({
            transcript: [snippetMessage(result)],
            history: [],
            revalidate: evidence => revalidateVaultObservationFromApp(fixture.host, evidence),
            getEpoch: () => "epoch-1",
        });
        const projected = JSON.parse(toolResultContent(projection.transcript[0]!).promptText) as {
            observation: VaultSnippetSearchOutput;
        };
        expect(projected.observation.matches.map(match => match.path)).toEqual(["notes/b.md"]);
        expect(projected.observation.coverage).toEqual({ state: "partial" });
        expect(projected.observation.page).toBeUndefined();
        await projection.binding.prepare();
        projection.binding.assertCurrent();

        toolResultContent(projection.transcript[0]!).promptText = originalPrompt;
        await expect(projection.binding.prepare()).rejects.toThrow("changed before dispatch");
    });

    it("hashes the original snippet content version, not a JSON string", async () => {
        const content = "# Original\nneedle";
        const file = makeFile("notes/hash.md", content.length);
        const fixture = snippetFixture([file], new Map([["notes/hash.md", content]]));
        const result = await fixture.invoke({ query: "needle", limit: 5 });
        const evidence = requireSnippetEvidence(result) as Extract<VaultObservationEvidence, { tool: "search_vault_snippets" }>;
        expect(evidence.items[0].contentHash).not.toBe(await computeContentHash(JSON.stringify(content)));
        expect(evidence.items[0].contentHash).toBe(await computeContentHash(content));
    });
});

describe("T-07 inspect evidence foundation", () => {
    function inspectFixture(cache: Record<string, unknown>, content = "BODY") {
        const file = makeFile("notes/inspect.md", 100);
        let cacheReads = 0;
        const host = {
            app: {
                vault: {
                    getMarkdownFiles: () => [file],
                    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
                    cachedRead: async () => {
                        cacheReads += 1;
                        return content;
                    },
                },
                metadataCache: {
                    getFileCache: () => cache,
                    resolvedLinks: { "notes/source.md": { "notes/inspect.md": 1 } },
                    unresolvedLinks: {},
                },
            },
        } as unknown as AiServiceHost;
        const tool = createInspectObsidianNoteTool();
        return {
            tool,
            host,
            file,
            cache,
            get cacheReads() { return cacheReads; },
            invoke: (raw: Record<string, unknown>) => tool.execute(tool.validateInput(raw), { host }),
        };
    }

    it("freezes the cache projection used by the actual output before asynchronous hashing", async () => {
        const cache = {
            headings: [{ heading: "A", level: 2 }],
            links: [],
            embeds: [],
            listItems: [],
            sections: [],
            blocks: {},
        };
        const fixture = inspectFixture(cache);
        const hashMock = computeContentHash as jest.MockedFunction<typeof computeContentHash>;
        let mutated = false;
        hashMock.mockImplementation(async (input: string) => {
            if (!mutated && input.includes('"text":"A"')) {
                mutated = true;
                cache.headings[0].heading = "B";
            }
            const { createHash } = jest.requireActual("node:crypto") as typeof import("node:crypto");
            return createHash("sha1").update(input, "utf8").digest("hex");
        });
        const result = await fixture.invoke({ path: "notes/inspect.md" });
        hashMock.mockImplementation(async input => {
            const { createHash } = jest.requireActual("node:crypto") as typeof import("node:crypto");
            return createHash("sha1").update(input, "utf8").digest("hex");
        });
        expect(result.ok).toBe(true);
        expect(mutated).toBe(true);
        expect(result.content).toMatchObject({ headings: [{ text: "A", level: 2 }] });
        const parsed = parseVaultObservationEvidence(result.vaultObservationEvidence);
        if (!parsed.ok) throw new Error(parsed.reason);
        expect(parsed.evidence.items[0].outputDigest).toBeDefined();
        expect(parsed.evidence.items[0].outputDigest).toBe(await hashObservationValue(result.content));
        await expect(revalidateVaultObservationFromApp(fixture.host, parsed.evidence))
            .resolves.toMatchObject({ validItemIndexes: [], aggregateCurrent: false });
        expect(fixture.cacheReads).toBe(0);
    });

    it("keeps producer and revalidation on one bounded 120-character insertion-order property projection", async () => {
        const cache = {
            frontmatter: { detail: "x".repeat(200) },
            headings: [],
            links: [],
            embeds: [],
            listItems: [],
            sections: [],
            blocks: {},
        };
        const fixture = inspectFixture(cache);
        const result = await fixture.invoke({ path: "notes/inspect.md" });
        expect(result.ok).toBe(true);
        expect(result.content?.properties).toEqual({ detail: `${"x".repeat(120)}...` });
        const parsed = parseVaultObservationEvidence(result.vaultObservationEvidence);
        if (!parsed.ok) throw new Error(parsed.reason);
        await expect(revalidateVaultObservationFromApp(fixture.host, parsed.evidence))
            .resolves.toMatchObject({ validItemIndexes: [0], aggregateCurrent: true });
        expect(fixture.cacheReads).toBe(0);
    });

    it("uses the same first-16 property selection for inspect output and revalidation", async () => {
        const makeCache = (visibleTail: string, unused: string) => {
            const frontmatter: Record<string, string> = {};
            for (let index = 17; index >= 2; index -= 1) frontmatter[`key${String(index).padStart(2, "0")}`] = "stable";
            frontmatter.key02 = visibleTail;
            frontmatter.key01 = unused;
            return {
                frontmatter,
                headings: [],
                links: [],
                embeds: [],
                listItems: [],
                sections: [],
                blocks: {},
            };
        };

        const visible = inspectFixture(makeCache("visible", "unused"));
        const visibleResult = await visible.invoke({ path: "notes/inspect.md" });
        const visibleEvidence = parseVaultObservationEvidence(visibleResult.vaultObservationEvidence);
        if (!visibleEvidence.ok) throw new Error(visibleEvidence.reason);
        (visible.cache.frontmatter as Record<string, string>).key02 = "changed";
        await expect(revalidateVaultObservationFromApp(visible.host, visibleEvidence.evidence))
            .resolves.toMatchObject({ validItemIndexes: [], aggregateCurrent: false });

        const unused = inspectFixture(makeCache("visible", "unused"));
        const unusedResult = await unused.invoke({ path: "notes/inspect.md" });
        const unusedEvidence = parseVaultObservationEvidence(unusedResult.vaultObservationEvidence);
        if (!unusedEvidence.ok) throw new Error(unusedEvidence.reason);
        (unused.cache.frontmatter as Record<string, string>).key01 = "changed";
        await expect(revalidateVaultObservationFromApp(unused.host, unusedEvidence.evidence))
            .resolves.toMatchObject({ validItemIndexes: [0], aggregateCurrent: true });
        expect(unused.cacheReads).toBe(0);
    });

    it("does not read a capped-out inspect frontmatter value", async () => {
        let cappedValueReads = 0;
        const frontmatter: Record<string, string> = {};
        for (let index = 1; index <= 16; index += 1) {
            frontmatter[`key${String(index).padStart(2, "0")}`] = "stable";
        }
        Object.defineProperty(frontmatter, "key17", {
            enumerable: true,
            configurable: true,
            get() {
                cappedValueReads += 1;
                throw new Error("capped inspect property must not be read");
            },
        });
        const fixture = inspectFixture({
            frontmatter,
            headings: [],
            links: [],
            embeds: [],
            listItems: [],
            sections: [],
            blocks: {},
        });
        const result = await fixture.invoke({ path: "notes/inspect.md" });
        expect(result.ok).toBe(true);
        expect(result.content?.properties).toEqual(
            Object.fromEntries(Array.from({ length: 16 }, (_, index) => [
                `key${String(index + 1).padStart(2, "0")}`,
                "stable",
            ])),
        );
        expect(cappedValueReads).toBe(0);

        (fixture.cache.frontmatter as Record<string, string>).key16 = "changed";
        const evidence = parseVaultObservationEvidence(result.vaultObservationEvidence);
        if (!evidence.ok) throw new Error(evidence.reason);
        await expect(revalidateVaultObservationFromApp(fixture.host, evidence.evidence))
            .resolves.toMatchObject({ validItemIndexes: [], aggregateCurrent: false });
        expect(cappedValueReads).toBe(0);
    });

    it("binds body-read evidence and rejects a same-stat body change", async () => {
        const content = "# Title\n\nBODY_SENTINEL";
        const cache = {
            headings: [{ heading: "Title", level: 1, position: { start: { line: 0 } } }],
            links: [],
            embeds: [],
            listItems: [],
            sections: [],
            blocks: {},
        };
        let current = content;
        const fixture = inspectFixture(cache, current);
        (fixture.host.app.vault as { cachedRead: unknown }).cachedRead = jest.fn(async () => current);
        const forcedBodyRead = createInspectObsidianNoteTool({ includeContentChars: 100 });
        const result = await forcedBodyRead.execute(
            forcedBodyRead.validateInput({ path: "notes/inspect.md" }),
            { host: fixture.host },
        );
        expect(result.ok).toBe(true);
        const output = result.content as InspectObsidianNoteOutput & { fullText?: string };
        expect(output.fullText).toContain("BODY_SENTINEL");
        const parsed = parseVaultObservationEvidence(result.vaultObservationEvidence) as {
            ok: true;
            evidence: Extract<VaultObservationEvidence, { tool: "inspect_obsidian_note" }>;
        };
        expect(parsed.evidence.items[0].bodyRead).toBe(true);
        await expect(revalidateVaultObservationFromApp(fixture.host, parsed.evidence))
            .resolves.toMatchObject({ validItemIndexes: [0], aggregateCurrent: true });
        current = "# Title\n\nCHANGED";
        await expect(revalidateVaultObservationFromApp(fixture.host, parsed.evidence))
            .resolves.toMatchObject({ validItemIndexes: [], aggregateCurrent: false });
    });
});

describe("T-07 strict reader and clone", () => {
    const baseRead = (): Record<string, unknown> => ({
        schemaVersion: 1,
        observationId: "read-observation",
        tool: "read_note",
        fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
        scope: { allowedPaths: ["notes/read.md"], excludedPaths: [] },
        coverage: { complete: true, truncated: false, endOfPart: true },
        items: [{
            kind: "read-result",
            outputDigest: "1".repeat(40),
            path: "notes/read.md",
            contentHash: "2".repeat(40),
            part: "body",
            range: { startLine: 1, endLine: 1, startOffset: 0, endOffset: 10, partialLine: false },
        }],
    });

    it("rejects unknown fields, forbidden aggregates, bad ranges, and inspect body-hash coupling", () => {
        const unknown = baseRead();
        (unknown as { extra?: unknown }).extra = true;
        expect(parseVaultObservationEvidence(unknown).ok).toBe(false);

        const aggregate = baseRead();
        aggregate.aggregate = { kind: "query" };
        expect(parseVaultObservationEvidence(aggregate).ok).toBe(false);

        const badRange = baseRead();
        (badRange.items as Array<{ range: Record<string, unknown> }>)[0].range.startLine = 0;
        expect(parseVaultObservationEvidence(badRange).ok).toBe(false);

        const inspect = {
            schemaVersion: 1,
            observationId: "inspect-observation",
            tool: "inspect_obsidian_note",
            fingerprint: { algorithm: "sha1", canonicalizationVersion: 1 },
            scope: { allowedPaths: null, excludedPaths: [] },
            coverage: {
                state: "complete", cacheState: "known", bodyRead: false,
                bodyRequired: false, evaluatedBacklinkSources: 0,
            },
            items: [{
                kind: "inspect-result", outputDigest: "1".repeat(40), path: "notes/a.md",
                cacheProjectionDigest: "2".repeat(40), linkFactsDigest: "3".repeat(40),
                bodyRead: false, bodyHash: "4".repeat(40),
            }],
        };
        expect(parseVaultObservationEvidence(inspect).ok).toBe(false);
    });

    it("preserves safe own __proto__ canonicalization and validates before cloning", () => {
        const own = Object.create(null);
        Object.defineProperty(own, "__proto__", {
            value: "safe-own-value", enumerable: true, configurable: true, writable: true,
        });
        const canonical = JSON.parse(stableJson(own)) as { __proto__?: string };
        expect(Object.keys(canonical)).toEqual(["__proto__"]);
        expect(Object.getOwnPropertyDescriptor(canonical, "__proto__")?.value).toBe("safe-own-value");

        const evidence = baseRead();
        const parsed = parseVaultObservationEvidence(evidence) as { ok: true; evidence: VaultObservationEvidence };
        const evidenceWithUndefined = {
            ...parsed.evidence,
            unknown: undefined,
        };
        expect(parseVaultObservationEvidence(evidenceWithUndefined).ok).toBe(false);
        expect(() => cloneVaultObservationEvidence(evidenceWithUndefined as VaultObservationEvidence)).toThrow();
    });

    it("strictly parses projection evidence before cloning invalid metadata", async () => {
        let unknownGetterReads = 0;
        const invalid = baseRead();
        Object.defineProperty(invalid, "unknown", {
            enumerable: true,
            configurable: true,
            get() {
                unknownGetterReads += 1;
                return undefined;
            },
        });
        const message: PaAgentMessage = {
            role: "toolResult",
            id: "invalid-evidence",
            toolCallId: "tool-call",
            toolName: "read_note",
            isError: false,
            timestamp: 1,
            content: {
                promptText: JSON.stringify({ tool: "read_note", status: "ok", observation: { text: "BODY" } }),
                includeInNextPrompt: true,
                sourceRecords: [{ kind: "context-used", dedupKey: "read", sourceBoundary: "read-only-tool", path: "notes/read.md" }],
                metadata: {
                    vaultObservationEvidence: invalid,
                    vaultObservationContractVersion: 1,
                },
            },
        };
        const revalidate = jest.fn(async () => {
            throw new Error("invalid evidence must not be revalidated");
        });
        const projection = await prepareVaultObservationProjection({
            transcript: [message],
            history: [],
            revalidate,
            getEpoch: () => "epoch-invalid",
        });
        const content = toolResultContent(projection.transcript[0]!);
        expect(content.promptText).not.toContain("BODY");
        expect(content.sourceRecords).toEqual([]);
        expect(content.metadata).toMatchObject({
            vaultObservationContractVersion: 1,
            vaultObservationEvidenceInvalid: true,
        });
        expect(revalidate).not.toHaveBeenCalled();
        expect(unknownGetterReads).toBe(0);
    });

    it("enforces per-envelope and whole-turn evidence budgets", () => {
        const evidence = baseRead();
        const parsed = parseVaultObservationEvidence(evidence) as { ok: true; evidence: VaultObservationEvidence };
        expect(() => {
            const oversizedScope = { ...parsed.evidence, scope: { allowedPaths: [], excludedPaths: [] } };
            Object.assign(oversizedScope, {
                observationId: "x".repeat(256),
                scope: {
                    allowedPaths: Array.from({ length: 500 }, () => "x".repeat(4096)),
                    excludedPaths: [],
                },
            });
        }).not.toThrow();
        expect(parseVaultObservationEvidence({
            ...parsed.evidence,
            scope: {
                allowedPaths: Array.from({ length: 500 }, () => "x".repeat(4096)),
                excludedPaths: [],
            },
        }).ok).toBe(false);
        expect(MAX_VAULT_OBSERVATION_ENVELOPES_PER_TURN).toBe(64);

        const longPath = `${"p".repeat(5_000)}.md`;
        const longPathEvidence = structuredClone(parsed.evidence);
        longPathEvidence.scope.allowedPaths = [longPath];
        longPathEvidence.items[0].path = longPath;
        expect(parseVaultObservationEvidence(longPathEvidence).ok).toBe(true);
    });

    it("accepts a legal cross-line snippet range and directly enforces whole-turn budgets", async () => {
        const content = "xxfoo\nb";
        const file = makeFile("notes/cross-line.md", content.length);
        const fixture = snippetFixture([file], new Map([["notes/cross-line.md", content]]));
        const result = await fixture.invoke({ query: "foo\nb", limit: 5 });
        expect(result.content!.matches[0]!.range).toMatchObject({
            startLine: 1,
            endLine: 2,
            startColumn: 3,
            endColumn: 2,
        });
        const parsed = parseVaultObservationEvidence(result.vaultObservationEvidence);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error(parsed.reason);
        expect(cloneVaultObservationEvidence(parsed.evidence)).toEqual(parsed.evidence);
        await expect(revalidateVaultObservationFromApp(fixture.host, parsed.evidence))
            .resolves.toMatchObject({ validItemIndexes: [0], aggregateCurrent: true });

        expect(() => assertVaultObservationHistory(Array.from({ length: 65 }, () => parsed.evidence))).toThrow();
        const heavyEvidence = structuredClone(parsed.evidence);
        heavyEvidence.scope.allowedPaths = Array.from({ length: 400 }, (_, index) => `notes/${index}/${"x".repeat(220)}`);
        expect(parseVaultObservationEvidence(heavyEvidence).ok).toBe(true);
        expect(() => assertVaultObservationHistory(Array.from({ length: 6 }, () => heavyEvidence))).toThrow();
        expect(() => assertVaultObservationHistory(Array.from({ length: 64 }, () => parsed.evidence))).not.toThrow();
    });

    it("rejects an unknown history field before traversing its payload", () => {
        const evidence = baseRead();
        const parsed = parseVaultObservationEvidence(evidence) as { ok: true; evidence: VaultObservationEvidence };
        let getterCalled = false;
        const malicious = {
            ...parsed.evidence,
            unknown: Object.defineProperty({}, "payload", {
                enumerable: true,
                configurable: true,
                get() {
                    getterCalled = true;
                    return "MALFORMED_PAYLOAD_SENTINEL";
                },
            }),
        };
        expect(() => assertVaultObservationHistory([malicious])).toThrow("Unknown vault observation field");
        expect(getterCalled).toBe(false);
    });
});
