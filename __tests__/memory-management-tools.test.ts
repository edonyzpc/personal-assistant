import { describe, expect, it, jest } from "@jest/globals";

import type {
    AiServiceHost,
    MemoryManagementReadPort,
} from "../src/ai-services/AiServiceHost";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PaAgentRuntime } from "../src/ai-services/pa-agent-runtime";
import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';

jest.mock("obsidian");

const MEMORY_MANAGEMENT_TOOL_NAMES = [
    "get_memory_status",
    "query_memories",
    "get_memory_usage",
] as const;
const MANAGE_MEMORY_TOOL_NAME = "manage_memory" as const;

function createHost(): AiServiceHost {
    return {
        settings: {
            debug: false,
            aiProvider: "test-provider",
            baseURL: "https://provider.invalid",
            chatModelName: "chat-model",
            policyModelName: "policy-model",
            embeddingModelName: "embedding-model",
            shareAnonymousCapabilityUsage: false,
            qwenThinkingEnabled: false,
            webSearchEnabled: false,
            licenseTier: "free",
            memoryEnabled: true,
            operationsAgentEnabled: false,
            operationsProactiveSaveSuggestionsEnabled: false,
            operationsAuditIncludeContent: false,
            operationsAuditRetentionDays: 30,
            statisticsVaultId: "test-vault",
        },
        log: jest.fn(),
        isOperationsAgentEnabled: false,
        getMemoryExtractionPromptContext: () => undefined,
        memorySearch: {
            search: jest.fn(),
        },
    } as unknown as AiServiceHost;
}

function createPortHost(
    memoryManagement: MemoryManagementReadPort,
    memoryEnabled = true,
): AiServiceHost {
    const host = createHost();
    (host as { memoryManagement?: MemoryManagementReadPort }).memoryManagement = memoryManagement;
    host.settings.memoryEnabled = memoryEnabled;
    return host;
}

function createRuntimeRegistry(host = createHost()): CapabilityRegistry {
    const runtime = new PaAgentRuntime(host, {
        createChatModel: jest.fn(),
    } as never, {
        skillContextProvider: null,
    });
    return (runtime as unknown as { toolRegistry: CapabilityRegistry }).toolRegistry;
}

describe("B-140 T-08 Memory management Chat tools", () => {
    it('does not reach a scoped Memory content port after Memory is turned off during preparation', async () => {
        let releasePrepare!: (value: unknown) => void;
        const prepareObservation = jest.fn(() => new Promise(resolve => { releasePrepare = resolve; }));
        const queryMemories = jest.fn(async () => { throw new Error('revoked Memory content read'); });
        const host = createPortHost({ prepareObservation, queryMemories } as unknown as MemoryManagementReadPort);
        const state = new TaskSourceConstraintState({ runId: 'combined-memory', userMessageId: 'user',
            userText: 'Read Memory', noteHandles: new Map(), sourceScope: 'combined' });
        const guard = state.createReadGuard(state.snapshot(), () => undefined, () => true,
            undefined, undefined, undefined, () => host.settings.memoryEnabled === true);
        const registry = createRuntimeRegistry(host);
        const pending = registry.execute('query_memories', { text: 'private' }, { host, taskSourceReadGuard: guard });
        await Promise.resolve();
        expect(prepareObservation).toHaveBeenCalledTimes(1);
        host.settings.memoryEnabled = false;
        releasePrepare({ purpose: 'memory_management', ready: true, memoryEnabled: true, stateFingerprint: 'old' });
        await pending;
        expect(queryMemories).not.toHaveBeenCalled();
    });
    it("exports and admits the three fixed read-only management tools", () => {
        const registry = createRuntimeRegistry();
        const names = registry.listDefinitions().map((definition) => definition.name);

        expect(names).toEqual(expect.arrayContaining([...MEMORY_MANAGEMENT_TOOL_NAMES]));

        for (const name of MEMORY_MANAGEMENT_TOOL_NAMES) {
            expect(registry.getDefinition(name)).toMatchObject({
                name,
                permission: "read-only",
                cost: "free",
                requiresConfirmation: false,
                failureBehavior: "recoverable",
                sourceBoundary: "memory",
            });
            expect(registry.canExecute(name)).toMatchObject({ allowed: true });
        }

        const exported = registry.exportProviderSchemasSafe();
        expect(exported.ok).toBe(true);
        if (exported.ok) {
            const exportedNames = new Set(exported.schemas.map((schema) => schema.function.name));
            for (const name of MEMORY_MANAGEMENT_TOOL_NAMES) {
                expect(exportedNames.has(name)).toBe(true);
            }
        }
    });

    it("exports and admits the fixed Memory action tool through its host port", () => {
        const host = createHost();
        (host as { memoryActions?: { execute: unknown } }).memoryActions = {
            execute: jest.fn(),
        };

        const registry = createRuntimeRegistry(host);

        expect(registry.getDefinition(MANAGE_MEMORY_TOOL_NAME)).toMatchObject({
            name: MANAGE_MEMORY_TOOL_NAME,
            permission: "memory-management",
            sourceBoundary: "memory",
        });
        expect(registry.canExecute(MANAGE_MEMORY_TOOL_NAME)).toMatchObject({ allowed: true });

        const exported = registry.exportProviderSchemasSafe();
        expect(exported.ok).toBe(true);
        if (exported.ok) {
            expect(exported.schemas.map((schema) => schema.function.name))
                .toContain(MANAGE_MEMORY_TOOL_NAME);
        }
    });

    it("keeps Memory-off status observable while query and usage disclose no content", async () => {
        const port = {
            prepareObservation: jest.fn(async () => ({
                purpose: "memory_management" as const,
                ready: true,
                memoryEnabled: false,
                stateFingerprint: "status-off",
            })),
            getStatus: jest.fn(async () => ({
                kind: "memory-status" as const,
                available: true as const,
                memoryEnabled: false as const,
                contentAvailable: false as const,
                noteMemory: { status: "disabled" as const },
                learning: {
                    enabled: false,
                    status: "paused" as const,
                    governance: "ready" as const,
                    profile: "disabled" as const,
                    vaultInsights: "disabled" as const,
                },
                coverage: "complete" as const,
                recordCount: 0,
                recordCountKind: "exact" as const,
                managementTargetId: "memory-personalization" as const,
                existingUnderstanding: { available: false, status: "paused" as const },
            })),
            queryMemories: jest.fn(async (): Promise<import("../src/ai-services/memory-management-types").MemoryManagementQueryOutput | import("../src/ai-services/memory-management-types").MemoryManagementUnavailableOutput<"query">> => ({
                kind: "memory-query" as const,
                available: true as const,
                memoryEnabled: true as const,
                contentAvailable: true as const,
                query: {},
                items: [{
                    id: "secret-item", entityType: "governed_claim", text: "SECRET_MEMORY_ITEM",
                    authority: "explicit_user", effect: "future_answers", lifecycle: "active",
                    effectiveUse: "active", sources: [], supportedActions: [], detailTarget: { kind: "memory-settings", targetId: "secret-item" },
                }],
                matchCount: 1,
                matchCountKind: "exact",
                coverage: { state: "complete" },
            })),
            getUsage: jest.fn(async (): Promise<import("../src/ai-services/memory-management-types").MemoryManagementUsageOutput | import("../src/ai-services/memory-management-types").MemoryManagementUnavailableOutput<"current_run" | "history">> => ({
                kind: "memory-usage" as const,
                available: true as const,
                target: "current_run" as const,
                memoryEnabled: true as const,
                evidenceLevel: "writing_generation_snapshot",
                records: [{
                    evidenceLevel: "writing_generation_snapshot",
                    disclosure: "dispatch_snapshot",
                    claims: [{ claimId: "SECRET_MEMORY_ITEM", revisionId: "secret-revision" }],
                }],
            })),
        };
        const registry = createRuntimeRegistry(createPortHost(port, false));

        const status = await registry.execute("get_memory_status", {}, { host: createPortHost(port, false) });
        expect(status).toMatchObject({ ok: true, tool: "get_memory_status" });
        expect(JSON.stringify(status.content)).not.toContain("SECRET_MEMORY_ITEM");

        const query = await registry.execute("query_memories", { text: "secret" }, { host: createPortHost(port, false) });
        expect(query).toMatchObject({ ok: true, tool: "query_memories" });
        expect(query.content).toMatchObject({
            kind: "memory-query",
            available: false,
            reason: "memory_disabled",
            memoryEnabled: false,
            contentAvailable: false,
            items: [],
            matchCount: 0,
        });
        expect(JSON.stringify(query.content)).not.toContain("SECRET_MEMORY_ITEM");

        const usage = await registry.execute("get_memory_usage", {}, { host: createPortHost(port, false) });
        expect(usage).toMatchObject({ ok: true, tool: "get_memory_usage" });
        expect(usage.content).toMatchObject({
            kind: "memory-usage",
            available: false,
            reason: "memory_disabled",
            target: "current_run",
            evidenceLevel: "unknown",
        });
        expect(JSON.stringify(usage.content)).not.toContain("SECRET_MEMORY_ITEM");

        expect(port.queryMemories).not.toHaveBeenCalled();
        expect(port.getUsage).not.toHaveBeenCalled();
    });

    it("fails closed for missing, unready, and cache-lagged ports without maintenance calls", async () => {
        const maintenance = {
            initialize: jest.fn(),
            migrate: jest.fn(),
            refresh: jest.fn(),
            rebuild: jest.fn(),
            learn: jest.fn(),
            write: jest.fn(),
        };
        const unready = {
            ...maintenance,
            prepareObservation: jest.fn(async () => ({
                purpose: "memory_management" as const,
                ready: false,
                reason: "cache_refresh_pending" as const,
                memoryEnabled: true,
            })),
            getStatus: jest.fn(),
            queryMemories: jest.fn(async (): Promise<import("../src/ai-services/memory-management-types").MemoryManagementQueryOutput | import("../src/ai-services/memory-management-types").MemoryManagementUnavailableOutput<"query">> => ({
                kind: "memory-query" as const,
                available: true as const,
                memoryEnabled: true as const,
                contentAvailable: true as const,
                query: {},
                items: [{
                    id: "secret-item", entityType: "governed_claim", text: "SECRET_MEMORY_ITEM",
                    authority: "explicit_user", effect: "future_answers", lifecycle: "active",
                    effectiveUse: "active", sources: [], supportedActions: [], detailTarget: { kind: "memory-settings", targetId: "secret-item" },
                }],
                matchCount: 1,
                matchCountKind: "exact",
                coverage: { state: "complete" },
            })),
            getUsage: jest.fn(async (): Promise<import("../src/ai-services/memory-management-types").MemoryManagementUsageOutput | import("../src/ai-services/memory-management-types").MemoryManagementUnavailableOutput<"current_run" | "history">> => ({
                kind: "memory-usage" as const,
                available: true as const,
                target: "current_run" as const,
                memoryEnabled: true as const,
                evidenceLevel: "writing_generation_snapshot",
                records: [{
                    evidenceLevel: "writing_generation_snapshot",
                    disclosure: "dispatch_snapshot",
                    claims: [{ claimId: "SECRET_MEMORY_ITEM", revisionId: "secret-revision" }],
                }],
            })),
        };
        const missingHost = createHost();
        const registry = createRuntimeRegistry(missingHost);
        const unreadyHost = createPortHost(unready as unknown as MemoryManagementReadPort);

        for (const host of [missingHost, unreadyHost]) {
            for (const tool of MEMORY_MANAGEMENT_TOOL_NAMES) {
                const result = await registry.execute(tool, tool === "query_memories" ? { text: "x" } : {}, { host });
                expect(result.ok).toBe(false);
                expect(result.error).toContain("unavailable");
                expect(JSON.stringify(result)).not.toContain("SECRET_MEMORY_ITEM");
            }
        }

        expect(unready.getStatus).not.toHaveBeenCalled();
        expect(unready.queryMemories).not.toHaveBeenCalled();
        expect(unready.getUsage).not.toHaveBeenCalled();
        for (const [name, call] of Object.entries(maintenance)) {
            void name;
            expect(call).not.toHaveBeenCalled();
        }
    });
});
