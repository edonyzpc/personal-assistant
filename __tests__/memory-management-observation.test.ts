import { describe, expect, it, jest } from "@jest/globals";
import { AIMessageChunk } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";

import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import type { ChatToolDefinition } from "../src/ai-services/chat-tool-types";
import type {
    MemoryManagementQueryInput,
    MemoryManagementQueryOutput,
    MemoryManagementUnavailableOutput,
} from "../src/ai-services/memory-management-types";
import type { MemoryManagementEvidence } from "../src/ai-services/memory-management-evidence";
import {
    prepareMemoryManagementProjection,
    buildMemoryManagementEvidence,
    cloneMemoryManagementEvidence,
    projectMemoryManagementObservations,
} from "../src/ai-services/memory-management-evidence";
import { PaAgentContextSummarizer } from "../src/ai-services/context/PaAgentContextSummarizer";
import { isCurrentToolSummary } from "../src/ai-services/context/PaAgentContextSummaryTypes";
import { createMemoryManagementTools } from "../src/ai-services/memory-management-tools";
import { createMemoryManagementReadPort } from "../src/pa/memory-management-read";
import type { MemoryControlCenterSnapshot } from "../src/pa/memory-control-center";
import type { DeviceMemoryGovernanceStateV1, MemoryClaimRevision } from "../src/pa/memory-governance-persistence";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PaAgentRuntime } from "../src/ai-services/pa-agent-runtime";
import { AIUtils } from "../src/ai-services/ai-utils";
import { chatToolResultToPaAgentToolExecutionResult } from "../src/ai-services/pa-agent-host-tools";

jest.mock("obsidian");

function createMemoryOffHost() {
    const memoryManagement = {
        prepareObservation: jest.fn(async () => ({
            purpose: "memory_management",
            ready: true,
            memoryEnabled: false,
            commitSequence: 7,
            deviceMemoryCacheRefreshTargetSequence: 7,
            partition: "default",
            dataBoundary: "device-local",
            stateFingerprint: "status-off",
        })),
        getStatus: jest.fn(async () => ({
            memoryEnabled: false,
            status: "disabled",
            contentAvailable: false,
            managementTargetId: "memory-personalization",
        })),
        queryMemories: jest.fn(async () => ({
            kind: "memory-query", available: true, memoryEnabled: true, contentAvailable: true,
            query: {}, items: [{ id: "secret", text: "SECRET_MEMORY_ITEM" }], matchCount: 1,
            matchCountKind: "exact", coverage: { state: "complete" },
        })),
        getUsage: jest.fn(async () => ({
            kind: "memory-usage", available: true, target: "current_run", memoryEnabled: true,
            evidenceLevel: "context_record",
            records: [{ evidenceLevel: "context_record", disclosure: "selection_record", claims: [], contextClaims: [{ claimId: "SECRET_MEMORY_ITEM" }] }],
        })),
    };
    const host = {
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
            memoryEnabled: false,
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
        memoryManagement,
    } as unknown as AiServiceHost;
    return { host, memoryManagement };
}

function createRuntimeRegistry(host: AiServiceHost): CapabilityRegistry {
    const runtime = new PaAgentRuntime(host, {
        createChatModel: jest.fn(),
    } as never, {
        skillContextProvider: null,
    });
    return (runtime as unknown as { toolRegistry: CapabilityRegistry }).toolRegistry;
}

function realReaderFixture() {
    const revision = (claimId: string, id: string, summary: string): MemoryClaimRevision => ({
        claimId,
        id,
        summary,
        authority: "explicit_user",
        createdAt: "t1",
        provenance: [{ kind: "explicit_setting", settingKey: "synthetic" }],
    });
    let governed: DeviceMemoryGovernanceStateV1 = {
        schemaVersion: 3,
        commitSequence: 7,
        claims: ["A", "B"].map(id => ({
            id,
            partition: { kind: "vault", key: "vault" },
            memoryType: "preference",
            sensitivity: "low",
            applicability: { kind: "whole_vault" },
            activeRevisionId: `r${id}`,
            effect: "future_answers",
            lifecycle: "active",
            createdAt: "t1",
            updatedAt: "t1",
        })),
        revisions: [revision("A", "rA", "APPLE"), revision("B", "rB", "BANANA")],
        memoryQueueItems: [],
        projectionLinks: [],
        changeEvents: [],
        undoSnapshots: [],
        suppressionMarkers: [],
        pendingOperations: [],
        policyStates: {},
        migrationStates: {},
        migrationDeltas: [],
        rollbackPayloadEntries: [],
    };
    let snapshot: MemoryControlCenterSnapshot = {
        generatedAt: "t1",
        noteMemory: { enabled: true, status: "ready", indexedDocumentCount: 1234 },
        profile: { enabled: true, status: "ready", itemCount: 0 },
        vaultInsights: { enabled: false, status: "not_loaded" },
        durable: { activeCount: 2, pausedCount: 0, staleCount: 0 },
        boundary: { vaultScoped: true, deviceLocalProven: true, explanationKey: "test" },
        governanceMode: "effect_based",
        items: governed.claims.map(claim => ({
            id: claim.id,
            claimId: claim.id,
            label: claim.id === "A" ? "APPLE" : "BANANA",
            origin: "confirmed_memory",
            authority: "explicit_user",
            scopeLabel: "Current vault",
            effect: "future_answers",
            lifecycle: "active",
            provenance: [{ kind: "explicit_setting", settingKey: "synthetic" }],
            updatedAt: "t1",
            supportedActions: ["correct", "pause_use", "forget"],
        })),
        degradedSources: [],
    };
    const port = createMemoryManagementReadPort({
        getSettings: () => ({
            memoryEnabled: true,
            learningEnabled: true,
            learningStatus: "enabled",
            existingUnderstandingAvailable: true,
        }),
        getControlCenterSnapshot: async () => snapshot,
        getGovernedState: () => governed,
        getCacheTarget: () => 7,
        getVaultKey: () => "vault",
        getDataBoundaryFingerprint: () => "boundary",
        isDataBoundaryAllowedPath: () => true,
        getHistoryManager: () => undefined,
        getWritingVersions: () => undefined,
    });
    const removeQueryItem = (claimId: string) => {
        governed = {
            ...governed,
            commitSequence: governed.commitSequence + 1,
            claims: governed.claims.filter(claim => claim.id !== claimId),
            revisions: governed.revisions.filter(revision => revision.claimId !== claimId),
        };
        snapshot = {
            ...snapshot,
            generatedAt: `t${governed.commitSequence}`,
            items: snapshot.items.filter(item => item.claimId !== claimId),
        };
    };
    return {
        port,
        removeQueryItem,
        removeQueryA() {
            removeQueryItem("A");
        },
        forgetUsageA() {
            governed = {
                ...governed,
                commitSequence: 8,
                claims: governed.claims.map(claim => claim.id === "A"
                    ? { ...claim, lifecycle: "forgotten_tombstone" as const, updatedAt: "t2" }
                    : claim),
            };
            snapshot = {
                ...snapshot,
                generatedAt: "t2",
                items: snapshot.items.filter(item => item.claimId !== "A"),
            };
        },
        changeActiveA() {
            governed = {
                ...governed,
                claims: governed.claims.map(claim => claim.id === "A"
                    ? { ...claim, activeRevisionId: "rA2", updatedAt: "t2" }
                    : claim),
                revisions: [...governed.revisions, revision("A", "rA2", "APPLE NEW")],
            };
            snapshot.items = snapshot.items.map(item => item.claimId === "A"
                ? { ...item, label: "APPLE NEW", updatedAt: "t2" }
                : item);
        },
    };
}

describe("B-140 T-08 Memory management observations", () => {
    it("keeps Memory-off status observable without querying Memory content or usage", async () => {
        const { host, memoryManagement } = createMemoryOffHost();
        const registry = createRuntimeRegistry(host);

        const prepared = registry.prepareAndValidate("get_memory_status", {}, {
            userInput: "Explain the current Memory status.",
        });
        expect(prepared.ok).toBe(true);

        const result = await registry.execute("get_memory_status", {}, { host });
        expect(result.ok).toBe(true);
        expect(result.tool).toBe("get_memory_status");
        expect(result.content).toEqual(expect.objectContaining({
            memoryEnabled: false,
            contentAvailable: false,
        }));
        expect(memoryManagement.getStatus).toHaveBeenCalledTimes(1);
        expect(memoryManagement.queryMemories).not.toHaveBeenCalled();
        expect(memoryManagement.getUsage).not.toHaveBeenCalled();
    });

    it("binds status and query observations to closed management evidence", async () => {
        const { host, memoryManagement } = createMemoryOffHost();
        const registry = createRuntimeRegistry(host);
        const status = await registry.execute("get_memory_status", {}, { host });
        expect(status).toMatchObject({ ok: true });
        const statusExecution = chatToolResultToPaAgentToolExecutionResult(
            { type: "toolCall", id: "status-call", index: 0, name: "get_memory_status", input: {} }, status,
        );
        const statusEvidence = statusExecution.metadata?.memoryManagementEvidence as MemoryManagementEvidence;
        expect(statusEvidence).toMatchObject({
            purpose: "memory_management",
            tool: "get_memory_status",
            operation: "status",
        });

        (memoryManagement.prepareObservation as jest.MockedFunction<(expected?: unknown) => Promise<unknown>>).mockResolvedValue({
            purpose: "memory_management",
            ready: true,
            memoryEnabled: true,
            stateFingerprint: "query-state-1",
        });
        (memoryManagement.getStatus as jest.MockedFunction<() => Promise<unknown>>).mockResolvedValue({
            kind: "memory-status", available: true, memoryEnabled: true, contentAvailable: true,
        });
        (memoryManagement.queryMemories as jest.MockedFunction<(input: unknown) => Promise<unknown>>).mockResolvedValue({
            kind: "memory-query", available: true, memoryEnabled: true, contentAvailable: true,
            items: [{ id: "claim-b" }], matchCount: 1, matchCountKind: "exact",
        });
        const query = await registry.execute("query_memories", { text: "preference" }, { host });
        expect(query).toMatchObject({ ok: true });
        const queryExecution = chatToolResultToPaAgentToolExecutionResult(
            { type: "toolCall", id: "query-call", index: 0, name: "query_memories", input: { text: "preference" } }, query,
        );
        expect(queryExecution.metadata?.memoryManagementEvidence).toMatchObject({
            purpose: "memory_management",
            tool: "query_memories",
            operation: "query",
            stateFingerprint: "query-state-1",
        });

        const evidence = buildMemoryManagementEvidence({
            tool: "query_memories",
            operation: "query",
            stateFingerprint: "state-old",
            content: query.content,
        });
        const transcript = [
            {
                role: "toolResult" as const,
                id: "valid-a", toolCallId: "call-a", toolName: "get_memory_status", isError: false, timestamp: 1,
                content: {
                    promptText: "VALID_STATUS", includeInNextPrompt: true,
                    metadata: {
                        memoryManagementEvidence: buildMemoryManagementEvidence({
                            tool: "get_memory_status", operation: "status", stateFingerprint: "status-current",
                            content: { kind: "memory-status" },
                        }),
                    },
                },
            },
            {
                role: "toolResult" as const,
                id: "invalid-b", toolCallId: "call-b", toolName: "query_memories", isError: false, timestamp: 2,
                content: {
                    promptText: "OLD_EXACT_CLAIM", includeInNextPrompt: true,
                    metadata: { memoryManagementEvidence: evidence, memoryManagementContractVersion: 1 as const },
                },
            },
        ];
        const projected = await projectMemoryManagementObservations({
            transcript,
            prepareObservation: async expected => ({
                purpose: "memory_management",
                ready: expected.stateFingerprint === "status-current",
                memoryEnabled: true,
                stateFingerprint: expected.stateFingerprint === "status-current" ? "status-current" : "state-new",
            }),
        });
        expect((projected[0]?.content as { promptText?: string }).promptText).toContain("VALID_STATUS");
        expect((projected[1]?.content as { promptText?: string }).promptText).not.toContain("OLD_EXACT_CLAIM");
        expect((projected[1]?.content as { metadata?: Record<string, unknown> }).metadata?.memoryManagementEvidenceInvalid).toBe(true);
    });

    it("binds a normal filtered query to its actual bounded request and reading result", async () => {
        const { port } = realReaderFixture();
        const host = { memoryManagement: port } as unknown as AiServiceHost;
        const tool = createMemoryManagementTools().find(candidate => candidate.name === "query_memories")! as
            ChatToolDefinition<MemoryManagementQueryInput, MemoryManagementQueryOutput | MemoryManagementUnavailableOutput<"query">>;
        const result = await tool.execute(
            tool.validateInput({ text: "APPLE", limit: 1 }),
            { host },
        );
        expect(result.ok).toBe(true);
        expect(result.content).toMatchObject({ items: [{ id: "A", text: "APPLE" }] });
        expect(result.memoryManagementEvidence?.request).toMatchObject({
            text: "APPLE",
            limit: "1",
        });

        const revalidated = await port.prepareObservation(result.memoryManagementEvidence!);
        expect(revalidated).not.toHaveProperty("reason");
        const projected = await projectMemoryManagementObservations({
            transcript: [{
                role: "toolResult",
                id: "query-a",
                toolCallId: "call-a",
                toolName: "query_memories",
                isError: false,
                timestamp: 1,
                content: {
                    promptText: JSON.stringify({
                        tool: "query_memories",
                        status: "ok",
                        input: "APPLE",
                        observation: result.content,
                    }),
                    includeInNextPrompt: true,
                    metadata: {
                        memoryManagementContractVersion: 1,
                        memoryManagementEvidence: result.memoryManagementEvidence,
                    },
                },
            }],
            prepareObservation: evidence => port.prepareObservation(evidence),
        });
        const projectedMessage = projected[0];
        expect(projectedMessage?.role).toBe("toolResult");
        expect(projectedMessage?.role === "toolResult" ? projectedMessage.content.promptText : "").toContain("APPLE");

        const unfiltered = await tool.execute(tool.validateInput({ limit: 2 }), { host });
        expect(unfiltered.ok).toBe(true);
        expect(unfiltered.content).toMatchObject({ items: [{ id: "A" }, { id: "B" }] });
    });

    it("withdraws an applied Memory action receipt after its exact revision is superseded", async () => {
        const { port, changeActiveA } = realReaderFixture();
        const content = {
            kind: "memory-action",
            action: "remember",
            status: "applied",
            claimId: "A",
            revisionId: "rA",
        };
        const provisional = buildMemoryManagementEvidence({
            tool: "manage_memory",
            operation: "action",
            stateFingerprint: "pending-observation",
            request: {
                action: "remember",
                status: "applied",
                claimId: "A",
                revisionId: "rA",
            },
            content,
        });
        const initial = await port.prepareObservation({
            operation: provisional.operation,
            request: provisional.request,
            contentFingerprint: provisional.contentFingerprint,
            aggregateFingerprint: provisional.aggregateFingerprint,
            items: provisional.items,
        });
        expect(initial).toMatchObject({
            ready: true,
            validItemIndexes: [0],
            aggregateCurrent: true,
            stateFingerprint: expect.any(String),
        });

        const evidence = {
            ...provisional,
            stateFingerprint: initial.stateFingerprint!,
        };
        await expect(port.prepareObservation(evidence)).resolves.toMatchObject({
            validItemIndexes: [0],
            aggregateCurrent: true,
        });

        changeActiveA();
        await expect(port.prepareObservation(evidence)).resolves.toMatchObject({
            validItemIndexes: [],
            aggregateCurrent: false,
        });
    });

    it("keeps an independently valid item while withdrawing an expired aggregate promise", async () => {
        const queryEvidence = buildMemoryManagementEvidence({
            tool: "query_memories",
            operation: "query",
            stateFingerprint: "query-state",
            request: { text: "fruit", limit: "2" },
            content: {
                kind: "memory-query",
                available: true,
                memoryEnabled: true,
                contentAvailable: true,
                query: { text: "fruit" },
                items: [
                    { id: "A", entityType: "governed_claim", authority: "explicit_user", effect: "future_answers", lifecycle: "active", effectiveUse: "active", sources: [], detailTarget: { kind: "memory-settings", targetId: "A" } },
                    { id: "B", entityType: "governed_claim", authority: "explicit_user", effect: "future_answers", lifecycle: "active", effectiveUse: "active", sources: [], detailTarget: { kind: "memory-settings", targetId: "B" } },
                ],
                matchCount: 2,
                matchCountKind: "exact",
                coverage: { state: "complete" },
            },
        });
        const transcript = [{
            role: "toolResult" as const,
            id: "query-old",
            toolCallId: "call-old",
            toolName: "query_memories",
            isError: false,
            timestamp: 1,
            content: {
                promptText: JSON.stringify({
                    tool: "query_memories",
                    status: "ok",
                    input: "fruit",
                    observation: {
                        kind: "memory-query",
                        available: true,
                        memoryEnabled: true,
                        contentAvailable: true,
                        query: { text: "fruit" },
                        items: [
                            { id: "A", text: "APPLE" },
                            { id: "B", text: "BANANA" },
                        ],
                        matchCount: 2,
                        matchCountKind: "exact",
                        coverage: { state: "complete" },
                    },
                }),
                includeInNextPrompt: true,
                metadata: {
                    memoryManagementContractVersion: 1 as const,
                    memoryManagementEvidence: queryEvidence,
                },
            },
        }];
        const projected = await projectMemoryManagementObservations({
            transcript,
            prepareObservation: async () => ({
                purpose: "memory_management" as const,
                ready: true,
                memoryEnabled: true,
                stateFingerprint: "query-state",
                validItemIndexes: [1],
                aggregateCurrent: false,
                projectedContent: {
                    kind: "memory-query",
                    available: true,
                    memoryEnabled: true,
                    contentAvailable: true,
                    query: { text: "fruit" },
                    items: [{
                        id: "B",
                        entityType: "governed_claim",
                        text: "BANANA",
                        authority: "explicit_user",
                        effect: "future_answers",
                        lifecycle: "active",
                        effectiveUse: "active",
                        sources: [],
                        detailTarget: { kind: "memory-settings", targetId: "B" },
                    }],
                    matchCount: 1,
                    matchCountKind: "partial",
                    coverage: { state: "partial" },
                },
            }),
        });
        const projectedMessage = projected[0];
        const text = projectedMessage?.role === "toolResult" ? projectedMessage.content.promptText : "";
        expect(text).toContain("BANANA");
        expect(text).not.toContain("APPLE");
        expect(text).not.toContain("\"matchCount\":2");
        expect(text).not.toContain("\"matchCountKind\":\"exact\"");
        expect(text).not.toContain("\"nextCursor\"");
    });

    it("keeps a shifted valid query item through repeated projection, physical binding, and history summary", async () => {
        const { port, removeQueryA } = realReaderFixture();
        const content = await port.queryMemories({ limit: 2 });
        if (!content.available) throw new Error("Expected an available query result.");
        const evidence = buildMemoryManagementEvidence({
            tool: "query_memories",
            operation: "query",
            stateFingerprint: "query-initial",
            request: { limit: "2" },
            content,
        });
        const toolMessage = {
            role: "toolResult" as const,
            id: "query-shift",
            toolCallId: "call-query-shift",
            toolName: "query_memories",
            isError: false,
            timestamp: 1,
            content: {
                promptText: JSON.stringify({
                    tool: "query_memories",
                    status: "ok",
                    input: { limit: 2 },
                    observation: content,
                }),
                includeInNextPrompt: true,
                metadata: {
                    memoryManagementContractVersion: 1 as const,
                    memoryManagementEvidence: evidence,
                },
            },
        };
        const history = [
            { role: "user" as const, content: "What Memory records do you see?" },
            {
                role: "assistant" as const,
                content: "APPLE and BANANA are current.",
                canonicalTurn: {
                    schemaVersion: 1 as const,
                    runId: "run-query-shift",
                    turnId: "turn-query-shift",
                    memoryManagementEvidence: [evidence],
                    memoryManagementContractVersion: 1 as const,
                    messages: [toolMessage],
                },
            },
        ];
        removeQueryA();

        const first = await prepareMemoryManagementProjection({
            transcript: [toolMessage],
            history,
            prepareObservation: expected => port.prepareObservation(expected),
        });
        const projectedTool = first.transcript[0];
        const toolText = projectedTool?.role === "toolResult" ? projectedTool.content.promptText : "";
        const replacementEvidence = projectedTool?.role === "toolResult"
            ? projectedTool.content.metadata?.memoryManagementEvidence as MemoryManagementEvidence
            : undefined;
        expect(replacementEvidence?.items).toHaveLength(1);
        expect(replacementEvidence?.items[0]?.identity).toContain("\"id\":\"B\"");
        expect(toolText).toContain("BANANA");
        expect(toolText).not.toContain("APPLE");
        expect(toolText).not.toContain("\"matchCount\":1");
        const projectedAssistant = first.history.find(message => message.role === "assistant");
        expect(projectedAssistant?.content).toContain("BANANA");
        expect(projectedAssistant?.content).not.toContain("APPLE");
        expect(first.history.some(message => message.content === "What Memory records do you see?")).toBe(true);
        expect(projectedAssistant?.canonicalTurn?.messages).toEqual([]);
        expect(projectedAssistant?.canonicalTurn?.memoryManagementEvidence).toHaveLength(1);
        await first.binding.prepare();
        expect(() => first.binding.assertCurrent()).not.toThrow();

        const second = await prepareMemoryManagementProjection({
            transcript: first.transcript,
            history: first.history,
            prepareObservation: expected => port.prepareObservation(expected),
        });
        expect(second.transcript[0]?.role === "toolResult"
            ? second.transcript[0].content.promptText
            : "").toBe(toolText);
        expect(second.history.find(message => message.role === "assistant")?.content)
            .toBe(projectedAssistant?.content);
        await second.binding.prepare();
        expect(() => second.binding.assertCurrent()).not.toThrow();

        const summaryHistory = second.history.map(message => message.role === "assistant"
            ? {
                ...message,
                content: `${message.content}\n${Array.from(
                    { length: 500 },
                    (_unused, index) => `BANANA summary source ${index}.`,
                ).join(" ")}`,
            }
            : message);
        const summaryPayloads: Array<{ messages: Array<{ role: string; content: string }> }> = [];
        const summarizer = new PaAgentContextSummarizer();
        const summary = await summarizer.prepareHistory({
            history: summaryHistory,
            historyBudgetChars: 5_000,
            invoke: async payload => {
                summaryPayloads.push(payload);
                return JSON.stringify({
                    goals: [],
                    constraints: [],
                    decisions: [],
                    completed: [],
                    open_questions: [],
                    facts: [{ text: "BANANA remains permitted.", sourceMessages: [1] }],
                });
            },
        });
        expect(summaryPayloads.length).toBeGreaterThan(0);
        expect(summary).toBeDefined();
        const summaryRequest = JSON.stringify(summaryPayloads);
        expect(summaryRequest).toContain("BANANA");
        expect(summaryRequest).not.toContain("APPLE");
    });

    it("keeps a complete query observation when another observation in the same history expires", async () => {
        const { port, removeQueryItem } = realReaderFixture();
        const queryItem = async (itemId: "A" | "B") => {
            const content = await port.queryMemories({ itemId });
            if (!content.available) throw new Error(`Expected an available query for ${itemId}.`);
            return {
                content,
                evidence: buildMemoryManagementEvidence({
                    tool: "query_memories",
                    operation: "query",
                    stateFingerprint: "query-initial",
                    request: { itemId },
                    content,
                }),
            };
        };
        const queryA = await queryItem("A");
        const queryB = await queryItem("B");
        const toolMessage = (query: typeof queryA, id: string) => ({
            role: "toolResult" as const,
            id,
            toolCallId: `call-${id}`,
            toolName: "query_memories",
            isError: false,
            timestamp: 1,
            content: {
                promptText: JSON.stringify({
                    tool: "query_memories",
                    status: "ok",
                    input: { itemId: id },
                    observation: query.content,
                }),
                includeInNextPrompt: true,
                metadata: {
                    memoryManagementContractVersion: 1 as const,
                    memoryManagementEvidence: query.evidence,
                },
            },
        });
        const history = [
            { role: "user" as const, content: "What Memory records do you see?" },
            {
                role: "assistant" as const,
                content: "APPLE and BANANA are current.",
                canonicalTurn: {
                    schemaVersion: 1 as const,
                    runId: "run-multi-observation",
                    turnId: "turn-multi-observation",
                    memoryManagementEvidence: [queryA.evidence, queryB.evidence],
                    memoryManagementContractVersion: 1 as const,
                    messages: [toolMessage(queryA, "query-a"), toolMessage(queryB, "query-b")],
                },
            },
        ];
        removeQueryItem("A");

        const first = await prepareMemoryManagementProjection({
            history,
            prepareObservation: expected => port.prepareObservation(expected),
        });
        const firstAssistant = first.history.find(message => message.role === "assistant");
        expect(firstAssistant?.content).toContain("BANANA");
        expect(firstAssistant?.content).not.toContain("APPLE");
        expect(first.history.some(message => message.content === "What Memory records do you see?")).toBe(true);
        expect(firstAssistant?.canonicalTurn?.messages).toEqual([]);
        await first.binding.prepare();
        expect(() => first.binding.assertCurrent()).not.toThrow();

        const second = await prepareMemoryManagementProjection({
            history: first.history,
            prepareObservation: expected => port.prepareObservation(expected),
        });
        const secondAssistant = second.history.find(message => message.role === "assistant");
        expect(secondAssistant?.content).toBe(firstAssistant?.content);
        expect(secondAssistant?.content).toContain("BANANA");
        expect(secondAssistant?.content).not.toContain("APPLE");
        await second.binding.prepare();
        expect(() => second.binding.assertCurrent()).not.toThrow();

        removeQueryItem("B");
        const third = await prepareMemoryManagementProjection({
            history: second.history,
            prepareObservation: expected => port.prepareObservation(expected),
        });
        expect(third.history.map(message => message.role)).toEqual(["user"]);
        await third.binding.prepare();
        expect(() => third.binding.assertCurrent()).not.toThrow();
    });

    it("revalidates an independently valid item after its old query cursor expires", async () => {
        const { port, removeQueryA } = realReaderFixture();
        const firstPage = await port.queryMemories({ limit: 1 });
        if (!firstPage.available || !firstPage.nextCursor) throw new Error("Expected a bounded second page.");
        const secondPage = await port.queryMemories({ limit: 1, cursor: firstPage.nextCursor });
        if (!secondPage.available) throw new Error("Expected an available second page.");
        expect(secondPage.items).toMatchObject([{ id: "B", text: "BANANA" }]);
        const evidence = buildMemoryManagementEvidence({
            tool: "query_memories",
            operation: "query",
            stateFingerprint: "query-page-initial",
            request: { limit: "1", cursor: firstPage.nextCursor },
            content: secondPage,
        });
        removeQueryA();

        const observation = await port.prepareObservation(evidence);
        expect(observation).toMatchObject({
            ready: true,
            validItemIndexes: [0],
            aggregateCurrent: false,
        });
        const projection = await prepareMemoryManagementProjection({
            transcript: [{
                role: "toolResult",
                id: "query-cursor",
                toolCallId: "call-query-cursor",
                toolName: "query_memories",
                isError: false,
                timestamp: 1,
                content: {
                    promptText: JSON.stringify({
                        tool: "query_memories",
                        status: "ok",
                        input: { limit: 1, cursor: firstPage.nextCursor },
                        observation: secondPage,
                    }),
                    includeInNextPrompt: true,
                    metadata: {
                        memoryManagementContractVersion: 1 as const,
                        memoryManagementEvidence: evidence,
                    },
                },
            }],
            prepareObservation: expected => port.prepareObservation(expected),
        });
        const text = projection.transcript[0]?.role === "toolResult"
            ? projection.transcript[0].content.promptText
            : "";
        expect(text).toContain("BANANA");
        expect(text).not.toContain("APPLE");
        expect(text).not.toContain("nextCursor");
        await projection.binding.prepare();
        expect(() => projection.binding.assertCurrent()).not.toThrow();
    });

    it("keeps usage record level while redacting currently impermissible details", async () => {
        const oldContent = {
            kind: "memory-usage",
            available: true,
            target: "current_run",
            memoryEnabled: true,
            evidenceLevel: "writing_generation_snapshot",
            records: [{
                evidenceLevel: "writing_generation_snapshot",
                disclosure: "dispatch_snapshot",
                claims: [{ claimId: "A", revisionId: "rA" }],
            }],
        };
        const evidence = buildMemoryManagementEvidence({
            tool: "get_memory_usage",
            operation: "usage",
            stateFingerprint: "usage-state",
            request: {},
            content: oldContent,
        });
        const transcript = [{
            role: "toolResult" as const,
            id: "usage-old",
            toolCallId: "call-usage",
            toolName: "get_memory_usage",
            isError: false,
            timestamp: 1,
            content: {
                promptText: JSON.stringify({
                    tool: "get_memory_usage",
                    status: "ok",
                    input: "current_run",
                    observation: oldContent,
                }),
                includeInNextPrompt: true,
                metadata: {
                    memoryManagementContractVersion: 1 as const,
                    memoryManagementEvidence: evidence,
                },
            },
        }];
        const projected = await projectMemoryManagementObservations({
            transcript,
            prepareObservation: async () => ({
                purpose: "memory_management" as const,
                ready: true,
                memoryEnabled: true,
                stateFingerprint: "usage-state",
                validItemIndexes: [0],
                aggregateCurrent: false,
                projectedContent: {
                    ...oldContent,
                    records: [{
                        evidenceLevel: "writing_generation_snapshot",
                        disclosure: "dispatch_snapshot",
                        claims: [],
                    }],
                },
            }),
        });
        const message = projected[0];
        expect(message?.role).toBe("toolResult");
        const text = message?.role === "toolResult" ? message.content.promptText : "";
        expect(text).toContain("writing_generation_snapshot");
        expect(text).not.toContain("\"claimId\":\"A\"");
        expect(text).not.toContain("rA");
    });

    it("redacts forgotten usage details through the real reader and repeated physical preparation", async () => {
        const { port, forgetUsageA } = realReaderFixture();
        const currentUsage = () => ({
            writingGenerationInput: {
                schemaVersion: 1 as const,
                inputPurpose: "writing" as const,
                task: { state: "none" as const, sources: [] },
                personal: {
                    state: "identified" as const,
                    mode: "governed" as const,
                    revisions: [{ claimId: "A", revisionId: "rA" }],
                },
                insights: { state: "none" as const },
                style: { state: "none" as const },
                images: [],
                parent: { state: "none" as const },
                pagelet: { state: "none" as const },
            },
        });
        const content = await port.getUsage({}, currentUsage);
        if (!content.available) throw new Error("Expected available current usage.");
        const evidence = buildMemoryManagementEvidence({
            tool: "get_memory_usage",
            operation: "usage",
            stateFingerprint: "usage-initial",
            request: {},
            content,
        });
        const beforeForget = await port.prepareObservation(evidence, currentUsage);
        expect(beforeForget).toMatchObject({ ready: true, aggregateCurrent: true, validItemIndexes: [0] });

        forgetUsageA();
        const afterForget = await port.prepareObservation(evidence, currentUsage);
        expect(afterForget).toMatchObject({
            ready: true,
            validItemIndexes: [0],
            aggregateCurrent: false,
        });
        const projectedUsage = afterForget.projectedContent as typeof content;
        expect(projectedUsage.evidenceLevel).toBe(content.evidenceLevel);
        expect(projectedUsage.records[0]).toMatchObject({
            evidenceLevel: "writing_generation_snapshot",
            disclosure: "dispatch_snapshot",
            claims: [],
        });

        const toolMessage = {
            role: "toolResult" as const,
            id: "usage-forget",
            toolCallId: "call-usage-forget",
            toolName: "get_memory_usage",
            isError: false,
            timestamp: 1,
            content: {
                promptText: JSON.stringify({
                    tool: "get_memory_usage",
                    status: "ok",
                    input: {},
                    observation: content,
                }),
                includeInNextPrompt: true,
                metadata: {
                    memoryManagementContractVersion: 1 as const,
                    memoryManagementEvidence: evidence,
                },
            },
        };
        const first = await prepareMemoryManagementProjection({
            transcript: [toolMessage],
            prepareObservation: expected => port.prepareObservation(expected, currentUsage),
        });
        const firstText = first.transcript[0]?.role === "toolResult"
            ? first.transcript[0].content.promptText
            : "";
        const replacementEvidence = first.transcript[0]?.role === "toolResult"
            ? first.transcript[0].content.metadata?.memoryManagementEvidence as MemoryManagementEvidence
            : undefined;
        expect(replacementEvidence?.items).toHaveLength(1);
        expect(JSON.stringify(replacementEvidence)).not.toContain("\"claimId\":\"A\"");
        expect(firstText).toContain("writing_generation_snapshot");
        expect(firstText).not.toContain("\"claimId\":\"A\"");
        expect(firstText).not.toContain("rA");
        await first.binding.prepare();
        expect(() => first.binding.assertCurrent()).not.toThrow();

        const second = await prepareMemoryManagementProjection({
            transcript: first.transcript,
            prepareObservation: expected => port.prepareObservation(expected, currentUsage),
        });
        expect(second.transcript[0]?.role === "toolResult"
            ? second.transcript[0].content.promptText
            : "").toBe(firstText);
        await second.binding.prepare();
        expect(() => second.binding.assertCurrent()).not.toThrow();
    });

    it("revalidates trusted management evidence attached to assistant material", async () => {
        const evidence = buildMemoryManagementEvidence({
            tool: "get_memory_status",
            operation: "status",
            stateFingerprint: "state-old",
            content: { kind: "memory-status" },
        });
        let revalidations = 0;
        const projected = await projectMemoryManagementObservations({
            transcript: [{
                role: "assistant",
                id: "old-answer",
                content: [{ type: "text", text: "OLD_MANAGEMENT_TEXT" }],
                timestamp: 1,
                ...({ memoryManagementContractVersion: 1, memoryManagementEvidence: [evidence] } as Record<string, unknown>),
            } as never],
            prepareObservation: async () => {
                revalidations += 1;
                return { ready: false, memoryEnabled: true };
            },
        });
        expect(revalidations).toBe(1);
        expect(JSON.stringify(projected[0])).not.toContain("OLD_MANAGEMENT_TEXT");
    });

    it("deep-clones closed management evidence request fields", () => {
        const evidence = buildMemoryManagementEvidence({
            tool: "query_memories",
            operation: "query",
            stateFingerprint: "state",
            request: { text: "APPLE", limit: "1" },
            content: { kind: "memory-query" },
        });
        const cloned = cloneMemoryManagementEvidence(evidence);
        cloned.request.text = "MUTATED";
        expect(evidence.request.text).toBe("APPLE");
    });

    it("removes an assistant history turn whose management evidence expired", async () => {
        const evidence = buildMemoryManagementEvidence({
            tool: "get_memory_status",
            operation: "status",
            stateFingerprint: "state-old",
            content: { kind: "memory-status" },
        });
        let revalidations = 0;
        const projection = await prepareMemoryManagementProjection({
            history: [{
                role: "assistant",
                content: "OLD_HISTORY_STATUS",
                canonicalTurn: {
                    schemaVersion: 1,
                    runId: "run-history",
                    turnId: "turn-history",
                    memoryManagementEvidence: [evidence],
                    memoryManagementContractVersion: 1,
                    messages: [],
                },
            }],
            prepareObservation: async () => {
                revalidations += 1;
                return { ready: false, memoryEnabled: true };
            },
        });
        expect(revalidations).toBe(1);
        expect(projection.history).toEqual([]);
        await expect(projection.binding.prepare()).resolves.toBeUndefined();
        expect(() => projection.binding.assertCurrent()).not.toThrow();
    });

    it("fails closed when new-contract material has no revalidation port", async () => {
        const evidence = buildMemoryManagementEvidence({
            tool: "get_memory_status",
            operation: "status",
            stateFingerprint: "state-current",
            content: { kind: "memory-status" },
        });
        await expect(prepareMemoryManagementProjection({
            transcript: [{
                role: "toolResult",
                id: "management-without-port",
                toolCallId: "call-without-port",
                toolName: "get_memory_status",
                isError: false,
                timestamp: 1,
                content: {
                    promptText: "Memory status evidence exists.",
                    includeInNextPrompt: true,
                    metadata: {
                        memoryManagementContractVersion: 1 as const,
                        memoryManagementEvidence: evidence,
                    },
                },
            }],
            prepareObservation: async () => {
                throw new Error("unreachable");
            },
            portAvailable: false,
        })).rejects.toThrow("Memory management revalidation is unavailable.");
    });

    it("invalidates an actual tool summary when management projection withdraws its source", async () => {
        const evidence = buildMemoryManagementEvidence({
            tool: "get_memory_status",
            operation: "status",
            stateFingerprint: "state-summary",
            content: { kind: "memory-status" },
        });
        const source = {
            id: "management-summary",
            role: "toolResult" as const,
            toolCallId: "call-summary",
            toolName: "get_memory_status",
            isError: false,
            timestamp: 1,
            content: {
                promptText: `Memory status detail ${"x".repeat(4000)}`,
                includeInNextPrompt: true,
                metadata: {
                    memoryManagementContractVersion: 1 as const,
                    memoryManagementEvidence: evidence,
                },
            },
        };
        const summarizer = new PaAgentContextSummarizer();
        const summary = await summarizer.prepareTool({
            source,
            invoke: async () => JSON.stringify({
                goals: [],
                constraints: [],
                decisions: [],
                completed: [],
                open_questions: [],
                facts: [{ text: "Memory status retained.", sourceMessages: [1] }],
            }),
        });
        expect(summary).toBeDefined();
        const projected = await projectMemoryManagementObservations({
            transcript: [source],
            prepareObservation: async () => ({ ready: false, memoryEnabled: true }),
        });
        const projectedSource = projected[0];
        expect(projectedSource?.role).toBe("toolResult");
        expect(summary && projectedSource?.role === "toolResult"
            ? isCurrentToolSummary(summary, projectedSource)
            : true).toBe(false);
    });

    it("revokes an expired management observation before the next physical provider dispatch", async () => {
        let prepareCalls = 0;
        let revoked = false;
        const memoryManagement = {
            prepareObservation: jest.fn(async () => {
                prepareCalls += 1;
                return {
                    purpose: "memory_management" as const,
                    ready: true,
                    memoryEnabled: true,
                    stateFingerprint: revoked ? "management-state-2" : "management-state-1",
                    guard: {
                        assertCurrent(): void {
                            if (revoked) throw new Error("Memory management state changed before dispatch.");
                        },
                    },
                };
            }),
            getStatus: jest.fn(async () => ({
                kind: "memory-status" as const,
                available: true as const,
                memoryEnabled: true as const,
                contentAvailable: true as const,
                noteMemory: { status: "ready" as const, indexedDocumentCount: 776655 },
                learning: {
                    governance: "ready" as const,
                    profile: "ready" as const,
                    vaultInsights: "not_loaded" as const,
                },
                recordCount: 1,
                recordCountKind: "exact" as const,
                coverage: "complete" as const,
                managementTargetId: "memory-personalization" as const,
            })),
            queryMemories: jest.fn(),
            getUsage: jest.fn(),
        };
        const { host } = createMemoryOffHost();
        (host as { app?: unknown }).app = {};
        (host as unknown as { memoryManagement: unknown }).memoryManagement = memoryManagement;
        host.settings.memoryEnabled = true;
        const aiUtils = new AIUtils(host);
        const providerInputs: unknown[] = [];
        let modelTurn = 0;
        jest.spyOn(aiUtils, "createChatModel").mockImplementation(async (_temperature, options) => {
            const model = RunnableLambda.from(async function* (input: unknown) {
                await options?.prepareProviderRequest?.(new AbortController().signal);
                if (modelTurn === 1) revoked = true;
                options?.onProviderRequestStart?.();
                providerInputs.push(input);
                modelTurn += 1;
                if (modelTurn === 1) {
                    yield new AIMessageChunk({ content: "", tool_call_chunks: [{
                        id: "management-status-call", name: "get_memory_status", index: 0, args: "{}",
                    }] });
                    yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: "tool_calls" } });
                    return;
                }
                yield new AIMessageChunk({ content: "Memory status explained safely." });
                yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: "stop" } });
            });
            const bound = model as unknown as { bindTools?: unknown };
            bound.bindTools = () => bound;
            return bound as unknown as Awaited<ReturnType<AIUtils["createChatModel"]>>;
        });
        const runtime = new PaAgentRuntime(host, aiUtils, { skillContextProvider: null });

        const lifecycle: import("../src/ai-services/chat-types").AgentEvent[] = [];
        let runtimeError: unknown;
        await runtime.streamTurn({
            prompt: "Explain Memory status.",
            memoryMode: "auto",
            onLifecycleEvent: event => lifecycle.push(event),
        }).catch(error => {
            runtimeError = error;
        });
        runtime.dispose();

        expect(runtimeError).toBeInstanceOf(Error);
        expect((runtimeError as Error).message).toContain("Memory management state changed before dispatch.");
        expect(providerInputs).toHaveLength(1);
        const toolResult = lifecycle.find(event => event.type === "message_end" && event.message.role === "toolResult");
        expect(JSON.stringify(toolResult)).toContain("776655");
        // The first request was admitted while the evidence was current. The
        // state changed between prepare and onStart, so no second physical SDK
        // attempt may carry that now-expired observation.
        expect(JSON.stringify(providerInputs[0])).not.toContain("776655");
    });
});
