import { createInsightReadPort } from "../src/pa/insight-read-port";
import { buildMemoryManagementEvidence, prepareMemoryManagementProjection } from "../src/ai-services/memory-management-evidence";
import { createInsightReadTools } from "../src/ai-services/insight-read-tools";
import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';
import type { ChatToolContext } from "../src/ai-services/chat-tool-types";
import type { ChatMessage, PaAgentMessage } from "../src/ai-services/chat-types";
import type { VaultMetacognitionSnapshot } from "../src/ai-services/memory-extraction/type-c-analyzer";
import type { SavedInsight } from "../src/pa/saved-insight-store";

const snapshot: VaultMetacognitionSnapshot = {
    generatedAt: "2026-09-16T10:00:00.000Z",
    fileCount: 2,
    folderThemes: [{ folder: "work", count: 2 }],
    tagTaxonomy: [],
    linkTopology: { hubNotes: [], unresolvedLinks: [{ target: "maybe", count: 1 }] },
    writingHabits: { busiestWeekdays: [], averageWords: 42, recentlyActive: [] },
    topicClusters: [{ label: "A theme", paths: ["work/a.md"] }],
    knowledgeGaps: [{ label: "Possibly missing", evidence: "An unresolved link" }],
    trends: [],
};

function insight(id: string, path: string | null, status: SavedInsight["status"] = "active"): SavedInsight {
    return {
        id, type: "observation", text: `Saved ${id}`,
        origin: path ? "pa-generated" : "user-authored",
        sourceRefs: path ? [{ path }] : [], whyShown: [],
        scope: { kind: "custom", label: "Test" }, status,
        influencePolicy: "weak-only", createdAt: "2026-09-16T10:00:00.000Z",
        updatedAt: "2026-09-16T11:00:00.000Z",
    };
}

describe("existing insight read port", () => {
    it('does not read an Insight port from a web-scoped independent call', async () => {
        const getVaultInsights = jest.fn(() => { throw new Error('private Insight read'); });
        const state = new TaskSourceConstraintState({ runId: 'web-insight', userMessageId: 'user',
            userText: 'Web only', noteHandles: new Map(), sourceScope: 'web' });
        const guard = state.createReadGuard(state.snapshot(), () => undefined, () => true);
        const tool = createInsightReadTools().find(candidate => candidate.name === 'get_vault_insights');
        if (!tool) throw new Error('Missing Insight tool');
        await expect(tool.execute({}, { host: { insightRead: { getVaultInsights } } as unknown as ChatToolContext['host'],
            taskSourceReadGuard: guard })).rejects.toThrow('Task source note domain');
        expect(getVaultInsights).not.toHaveBeenCalled();
    });
    it("reads a prepared Type-C snapshot and revokes it when its complete source receipt changes", async () => {
        let sourceCurrent = true;
        const getVaultInsights = jest.fn(() => ({
            status: "ready" as const, snapshot, boundary: "b1", isSourceCurrent: () => sourceCurrent,
        }));
        const port = createInsightReadPort({
            isRuntimeCurrent: () => true, getVaultInsights,
            listSavedInsights: () => [], getBoundary: () => "b1",
            isPathAllowed: () => true, getSourceRevision: () => null,
        });
        const result = port.getVaultInsights();
        expect(result.content).toMatchObject({
            available: true, generatedAt: snapshot.generatedAt,
            coverage: { fileCount: 2, basis: "metadata_aggregate", presentation: "representative_top_three" },
            evidenceTypes: { knowledgeGaps: "inference" },
        });
        const evidence = buildMemoryManagementEvidence({
            tool: "get_vault_insights", operation: "vault_insights",
            stateFingerprint: result.stateFingerprint, content: result.content,
        });
        expect((await port.prepareObservation(evidence)).ready).toBe(true);
        sourceCurrent = false;
        expect(port.getVaultInsights().content).toMatchObject({ available: false, status: "stale_source" });
        expect((await port.prepareObservation(evidence)).ready).toBe(false);
        expect(getVaultInsights).toHaveBeenCalledTimes(4);
    });

    it("filters forbidden assets, includes archived/user-authored entries, and revokes a changed source", async () => {
        const file = {};
        let mtime = 1;
        const listSavedInsights = jest.fn(() => [
            insight("archived", "work/a.md", "archived"),
            insight("private", "private/secret.md"),
            insight("idea", null),
        ]);
        const port = createInsightReadPort({
            isRuntimeCurrent: () => true,
            getVaultInsights: () => ({ status: "not_loaded", snapshot: null, boundary: "b1", isSourceCurrent: () => false }),
            listSavedInsights, getBoundary: () => "b1",
            isPathAllowed: () => true,
            getSourceRevision: path => path === "work/a.md" ? { identity: file, mtime, ctime: 1, size: 8 } : null,
        });
        const result = port.querySavedInsights({ limit: 10 });
        expect(result.content.matchCount).toBe(2);
        expect(result.content.items).toEqual([
            expect.objectContaining({ id: "archived", status: "archived", sourceState: "path_present_content_unverified", text: "Saved archived" }),
            expect.objectContaining({ id: "idea", sourceState: "no_source_user_authored", text: "Saved idea" }),
        ]);
        const evidence = buildMemoryManagementEvidence({
            tool: "query_saved_insights", operation: "saved_insights", stateFingerprint: result.stateFingerprint,
            request: { limit: "10" }, content: result.content,
        });
        expect((await port.prepareObservation(evidence)).ready).toBe(true);
        mtime = 2;
        expect((await port.prepareObservation(evidence)).ready).toBe(false);
        expect(listSavedInsights).toHaveBeenCalledTimes(3);
    });

    it("exposes the two read-only tools with revalidated result evidence", async () => {
        const port = createInsightReadPort({
            isRuntimeCurrent: () => true,
            getVaultInsights: () => ({ status: "not_loaded", snapshot: null, boundary: "b1", isSourceCurrent: () => false }),
            listSavedInsights: () => [insight("idea", null)], getBoundary: () => "b1",
            isPathAllowed: () => true, getSourceRevision: () => null,
        });
        const tools = createInsightReadTools();
        expect(tools.map(tool => tool.name)).toEqual(["get_vault_insights", "query_saved_insights"]);
        expect(tools.every(tool => tool.permission === "read-only" && tool.requiresConfirmation === false)).toBe(true);
        const context = { host: { insightRead: port } } as unknown as ChatToolContext;
        const result = await tools[1].execute(tools[1].validateInput({ itemId: "idea" }), context);
        expect(result).toMatchObject({ ok: true, tool: "query_saved_insights", memoryManagementContractVersion: 1 });
        expect(result.content).toMatchObject({ matchCount: 1, items: [expect.objectContaining({ id: "idea" })] });
        expect((await port.prepareObservation(result.memoryManagementEvidence!)).ready).toBe(true);
        expect(() => tools[1].validateInput({ status: "forgotten" })).toThrow();
    });

    it("keeps a large saved list bounded and marks omitted matches", () => {
        const file = {};
        const entries = Array.from({ length: 10 }, (_, index) => ({
            ...insight(String(index), "work/a.md"),
            text: "x".repeat(2000),
            sourceRefs: Array.from({ length: 5 }, (_, source) => ({
                path: `work/${source}-${"p".repeat(140)}.md`, heading: "h".repeat(200),
            })),
        }));
        const port = createInsightReadPort({
            isRuntimeCurrent: () => true,
            getVaultInsights: () => ({ status: "not_loaded", snapshot: null, boundary: "b1", isSourceCurrent: () => false }),
            listSavedInsights: () => entries, getBoundary: () => "b1", isPathAllowed: () => true,
            getSourceRevision: () => ({ identity: file, mtime: 1, ctime: 1, size: 8 }),
        });
        const result = port.querySavedInsights({ limit: 10 });
        expect(JSON.stringify(result.content).length).toBeLessThanOrEqual(12_000);
        expect(result.content).toMatchObject({ matchCount: 10, coverage: "partial" });
    });

    it("withdraws a saved result and its answer before a physical retry after source change", async () => {
        const file = {};
        let mtime = 1;
        const port = createInsightReadPort({
            isRuntimeCurrent: () => true,
            getVaultInsights: () => ({ status: "not_loaded", snapshot: null, boundary: "b1", isSourceCurrent: () => false }),
            listSavedInsights: () => [insight("one", "work/a.md")], getBoundary: () => "b1",
            isPathAllowed: () => true,
            getSourceRevision: () => ({ identity: file, mtime, ctime: 1, size: 8 }),
        });
        const output = port.querySavedInsights({ limit: 10 });
        const evidence = buildMemoryManagementEvidence({
            tool: "query_saved_insights", operation: "saved_insights",
            stateFingerprint: output.stateFingerprint, request: { limit: "10" }, content: output.content,
        });
        const transcript = [{
            role: "toolResult", id: "tool-one", toolCallId: "call-one", toolName: "query_saved_insights",
            isError: false, timestamp: 1,
            content: {
                promptText: JSON.stringify({ tool: "query_saved_insights", status: "ok", observation: output.content }),
                includeInNextPrompt: true,
                metadata: { memoryManagementEvidence: evidence, memoryManagementContractVersion: 1 },
            },
        }] as PaAgentMessage[];
        const history = [{
            role: "assistant", content: "Saved one",
            memoryMetadata: { memoryManagementEvidence: [evidence], memoryManagementContractVersion: 1 },
        }] as ChatMessage[];
        const first = await prepareMemoryManagementProjection({
            transcript, history, prepareObservation: value => port.prepareObservation(value),
        });
        expect(first.transcript[0]?.role === "toolResult" ? first.transcript[0].content.promptText : "")
            .toContain("Saved one");
        mtime = 2;
        await expect(first.binding.prepare()).rejects.toThrow();
        const second = await prepareMemoryManagementProjection({
            transcript, history, prepareObservation: value => port.prepareObservation(value),
        });
        expect(second.transcript[0]?.role === "toolResult" ? second.transcript[0].content.promptText : "")
            .not.toContain("Saved one");
        expect(second.history.some(message => message.role === "assistant" && message.content.includes("Saved one"))).toBe(false);
    });
});
