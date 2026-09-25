import { createInsightActionPort } from "../src/pa/insight-action-port";
import { SavedInsightStore } from "../src/pa/saved-insight-store";
import { ReviewQueueStore } from "../src/pa/review-queue-store";
import { PaAgentRuntime } from "../src/ai-services/pa-agent-runtime";
import { createInsightActionTool } from "../src/ai-services/insight-action-tool";
import type { CapabilityRegistry } from "../src/ai-services/capability-registry";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";

jest.mock("obsidian");

const sourceVersion = "a".repeat(40);

function fixture() {
    let current = true;
    let sourceCurrent = true;
    let nextInsight = 0;
    let nextReview = 0;
    const saved = new SavedInsightStore({ idFactory: () => `ins-${++nextInsight}` });
    const review = new ReviewQueueStore({ idFactory: () => `rq-${++nextReview}` });
    const port = createInsightActionPort({
        getSavedStore: () => saved,
        getReviewStore: () => review,
        getBoundary: () => "boundary-1",
        isRuntimeCurrent: () => current,
        isItemAllowed: () => true,
        validateSource: async (path, version) => version === sourceVersion && path === "notes/source.md"
            ? { ref: { path, contentHash: version }, isCurrent: () => sourceCurrent }
            : null,
    });
    const binding = {
        runId: "run-1", userMessageId: "user-1", userPrompt: "请保存这个洞察，或稍后再看。",
        userPromptHash: "host-hash", isCurrent: () => current,
    };
    return { saved, review, port, binding, setCurrent: (value: boolean) => { current = value; },
        setSourceCurrent: (value: boolean) => { sourceCurrent = value; } };
}

describe("explicit insight action port", () => {
    it("does not enter the persistent action port after scoped note access is revoked", async () => {
        const { port, binding, saved } = fixture();
        const execute = jest.spyOn(port, 'execute');
        const tool = createInsightActionTool();
        const input = tool.validateInput({ action: 'save', userExpression: '请保存这个洞察',
            text: '用户想法', type: 'question', origin: 'user-authored' });
        const result = await tool.execute(input, { host: { insightActions: port }, memoryActionRequest: binding,
            taskSourceReadGuard: { isCurrent: () => true, isPathAllowed: () => true,
                isNoteDomainAllowed: () => false } } as never);
        expect(execute).not.toHaveBeenCalled();
        expect(saved.list()).toHaveLength(0);
        expect(result.content).not.toMatchObject({ status: 'applied' });
    });
    it("exports the fixed action tool and binds its execution to the current user request", async () => {
        const { port, binding, saved } = fixture();
        const host = {
            settings: {
                debug: false, aiProvider: "test", baseURL: "https://provider.invalid",
                chatModelName: "test", policyModelName: "test", embeddingModelName: "test",
                shareAnonymousCapabilityUsage: false, qwenThinkingEnabled: false, webSearchEnabled: false,
                licenseTier: "free", memoryEnabled: false, operationsAgentEnabled: false,
                operationsProactiveSaveSuggestionsEnabled: false, operationsAuditIncludeContent: false,
                operationsAuditRetentionDays: 30, statisticsVaultId: "test",
            },
            log: jest.fn(), isOperationsAgentEnabled: false,
            getMemoryExtractionPromptContext: () => undefined,
            memorySearch: { search: jest.fn() }, insightActions: port,
        } as unknown as AiServiceHost;
        const runtime = new PaAgentRuntime(host, { createChatModel: jest.fn() } as never, { skillContextProvider: null });
        const registry = (runtime as unknown as { toolRegistry: CapabilityRegistry }).toolRegistry;
        expect(registry.getDefinition("manage_saved_insight")).toMatchObject({
            name: "manage_saved_insight", permission: "insight-management", requiresConfirmation: false,
        });
        expect(registry.canExecute("manage_saved_insight")).toMatchObject({ allowed: true });
        const schemas = registry.exportProviderSchemasSafe();
        expect(schemas.ok && schemas.schemas.some(schema => schema.function.name === "manage_saved_insight")).toBe(true);
        const input = { action: "save", userExpression: "请保存这个洞察", text: "用户想法", type: "question", origin: "user-authored" };
        const missingBinding = await registry.execute("manage_saved_insight", input, { host });
        expect(missingBinding.content).toMatchObject({ status: "failed", reason: "action_unavailable" });
        const applied = await registry.execute("manage_saved_insight", input, { host, memoryActionRequest: binding });
        expect(applied.content).toMatchObject({ status: "applied", insightId: "ins-1" });
        expect(applied.resultFact).toMatchObject({ kind: "applied", action: "saved_insight",
            receiptId: expect.stringContaining('"insightId":"ins-1"') });
        expect(saved.list()).toHaveLength(1);
    });
    it("saves a user-authored item once, keeps weak-only effect, and rejects same-request drift", async () => {
        const { saved, review, port, binding } = fixture();
        const input = {
            action: "save" as const, userExpression: "请保存这个洞察", binding,
            text: "我想比较两条方案。", type: "question" as const, origin: "user-authored" as const,
        };
        const first = await port.execute(input);
        const replay = await port.execute(input);
        const conflict = await port.execute({ ...input, text: "另一条想法。" });
        expect(first).toMatchObject({ status: "applied", insightId: "ins-1", influencePolicy: "weak-only" });
        expect(replay).toEqual(first);
        expect(conflict).toMatchObject({ status: "failed", reason: "replay_conflict" });
        expect(saved.list()).toMatchObject([{ origin: "user-authored", sourceRefs: [], status: "active" }]);
        expect(review.list()).toEqual([]);
    });

    it("requires a live versioned note source for PA saves and Later, without promoting Memory", async () => {
        const { saved, review, port, binding, setSourceCurrent } = fixture();
        const base = {
            userExpression: "请保存这个洞察", binding, text: "两篇笔记提到同一主题。",
            sources: [{ path: "notes/source.md", sourceVersion }],
        };
        expect(await port.execute({ ...base, action: "save", type: "theme", origin: "pa-generated", sources: [] }))
            .toMatchObject({ status: "failed", reason: "source_required" });
        const savedResult = await port.execute({ ...base, action: "save", type: "theme", origin: "pa-generated" });
        expect(savedResult).toMatchObject({ status: "applied", insightId: "ins-1" });
        expect(saved.list()[0]).toMatchObject({ sourceRefs: [{ path: "notes/source.md", contentHash: sourceVersion }], influencePolicy: "weak-only" });
        const later = await port.execute({ ...base, action: "later", userExpression: "稍后再看" });
        expect(later).toMatchObject({ status: "applied", reviewItemId: "rq-1" });
        expect(review.list()[0]).toMatchObject({ type: "evidence_insight", admissionReason: "user_kept_for_later", status: "suggested" });
        expect(saved.list()).toHaveLength(1);
        setSourceCurrent(false);
        expect(await port.execute({ ...base, action: "later", userExpression: "稍后再看" }))
            .toMatchObject({ status: "failed" });
        const archived = await port.execute({
            action: "archive", userExpression: "请归档", binding: {
                ...binding, userMessageId: "archive-user", userPrompt: "请归档这个洞察", userPromptHash: "archive-hash",
            }, targetId: saved.list()[0].id, expectedUpdatedAt: saved.list()[0].updatedAt,
        });
        expect(archived).toMatchObject({ status: "applied", insightStatus: "archived" });
        expect(await port.execute({
            action: "restore", userExpression: "请恢复", binding: {
                ...binding, userMessageId: "restore-user", userPrompt: "请恢复这个洞察", userPromptHash: "restore-hash",
            }, targetId: saved.list()[0].id, expectedUpdatedAt: saved.list()[0].updatedAt,
        })).toMatchObject({ status: "failed", reason: "source_changed_or_forbidden" });
    });

    it("uses the displayed version for archive/restore and rejects cancelled requests", async () => {
        const { saved, port, binding, setCurrent } = fixture();
        await saved.create({ type: "question", text: "A", origin: "user-authored" });
        const original = saved.list()[0];
        const archiveBinding = { ...binding, userPrompt: "请归档这个洞察", userPromptHash: "archive-hash" };
        const restoreBinding = { ...binding, userMessageId: "user-2", userPrompt: "请恢复这个洞察", userPromptHash: "restore-hash" };
        const archive = await port.execute({
            action: "archive", userExpression: "请归档这个洞察", binding: archiveBinding,
            targetId: original.id, expectedUpdatedAt: original.updatedAt,
        });
        expect(archive).toMatchObject({ status: "applied", insightStatus: "archived" });
        const stale = await port.execute({
            action: "restore", userExpression: "请恢复这个洞察", binding: restoreBinding,
            targetId: original.id, expectedUpdatedAt: original.updatedAt,
        });
        expect(stale).toMatchObject({ status: "failed", reason: "stale_target" });
        setCurrent(false);
        expect(await port.execute({
            action: "restore", userExpression: "请恢复这个洞察", binding: restoreBinding,
            targetId: original.id, expectedUpdatedAt: saved.list()[0].updatedAt,
        })).toMatchObject({ status: "failed", reason: "request_not_current" });
        expect(saved.list()[0].status).toBe("archived");
    });
});
