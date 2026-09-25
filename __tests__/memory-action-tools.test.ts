import { describe, expect, it, jest } from "@jest/globals";

import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import type {
    MemoryActionHostBinding,
    MemoryActionPort,
} from "../src/ai-services/memory-action-types";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PaAgentRuntime } from "../src/ai-services/pa-agent-runtime";
import { createMemoryActionTool } from "../src/ai-services/memory-action-tools";

jest.mock("obsidian");

function createHost(memoryActions?: MemoryActionPort): AiServiceHost {
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
        memorySearch: { search: jest.fn() },
        ...(memoryActions ? { memoryActions } : {}),
    } as unknown as AiServiceHost;
}

function createRegistry(host: AiServiceHost): CapabilityRegistry {
    const runtime = new PaAgentRuntime(host, {
        createChatModel: jest.fn(),
    } as never, {
        skillContextProvider: null,
    });
    return (runtime as unknown as { toolRegistry: CapabilityRegistry }).toolRegistry;
}

function createBinding(): MemoryActionHostBinding {
    return {
        runId: "run-a",
        userMessageId: "run-a:source-user",
        userPrompt: "Please remember that I prefer concise replies.",
        userPromptHash: "prompt-hash-a",
        conversationId: "conversation-a",
        isCurrent: () => true,
    };
}

describe("B-140 T-09 Memory action tool", () => {
    it("does not enter the action port after scoped Memory permission is revoked", async () => {
        const execute = jest.fn<MemoryActionPort["execute"]>(async () => ({
            kind: "memory-action" as const, action: "remember" as const, status: "applied" as const,
            memoryEnabled: true, effectiveUse: "active" as const,
        }));
        const tool = createMemoryActionTool();
        const host = createHost({ execute });
        const input = tool.validateInput({ action: "remember", userExpression: "Please remember",
            content: "I prefer concise replies", memoryType: "preference", sensitivity: "low" });
        const result = await tool.execute(input, { host, memoryActionRequest: createBinding(),
            taskSourceReadGuard: { isCurrent: () => true, isPathAllowed: () => true,
                isMemoryAllowed: () => false } } as never);
        expect(execute).not.toHaveBeenCalled();
        expect(result.content).not.toMatchObject({ status: "applied" });
    });
    it("exports and executes the fixed tool only through a live host action binding", async () => {
        const execute = jest.fn<MemoryActionPort["execute"]>(async () => ({
            kind: "memory-action" as const,
            action: "remember" as const,
            status: "applied" as const,
            claimId: "claim-a",
            revisionId: "revision-a",
            eventId: "event-a",
            memoryEnabled: true,
            effectiveUse: "active" as const,
        }));
        const registry = createRegistry(createHost({ execute }));
        const binding = createBinding();

        expect(registry.getDefinition("manage_memory")).toMatchObject({
            name: "manage_memory",
            permission: "memory-management",
            sourceBoundary: "memory",
            requiresConfirmation: false,
        });
        expect(registry.canExecute("manage_memory")).toMatchObject({ allowed: true });

        const result = await registry.execute("manage_memory", {
            action: "remember",
            userExpression: "remember that I prefer concise replies",
            content: "I prefer concise replies.",
            memoryType: "preference",
            sensitivity: "low",
        }, {
            host: createHost({ execute }),
            memoryActionRequest: binding,
        });
        expect(result).toMatchObject({ ok: true, tool: "manage_memory" });
        expect(result.content).toMatchObject({ status: "applied", claimId: "claim-a" });
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({
            action: "remember",
            userExpression: "remember that I prefer concise replies",
            binding,
        }));
    });

    it("rejects forged confirmation and action execution without the live binding", async () => {
        const execute = jest.fn<MemoryActionPort["execute"]>();
        const registry = createRegistry(createHost({ execute }));
        const host = createHost({ execute });

        const forged = await registry.execute("manage_memory", {
            action: "remember",
            userExpression: "remember that I prefer concise replies",
            content: "I prefer concise replies.",
            memoryType: "preference",
            sensitivity: "low",
            confirmed: true,
        }, { host, memoryActionRequest: createBinding() });
        expect(forged).toMatchObject({ ok: false, tool: "manage_memory" });

        const unbound = await registry.execute("manage_memory", {
            action: "remember",
            userExpression: "remember that I prefer concise replies",
            content: "I prefer concise replies.",
            memoryType: "preference",
            sensitivity: "low",
        }, { host });
        expect(unbound).toMatchObject({ ok: true });
        expect(unbound.content).toMatchObject({
            status: "failed",
            reason: "action_binding_missing",
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it("rejects target fields that do not belong to remember", async () => {
        const execute = jest.fn<MemoryActionPort["execute"]>();
        const host = createHost({ execute });
        const registry = createRegistry(host);

        const result = await registry.execute("manage_memory", {
            action: "remember",
            userExpression: "remember that I prefer concise replies",
            content: "I prefer concise replies.",
            memoryType: "preference",
            sensitivity: "low",
            targetId: "claim-forged",
        }, { host, memoryActionRequest: createBinding() });

        expect(result).toMatchObject({ ok: false, tool: "manage_memory" });
        expect(execute).not.toHaveBeenCalled();
    });

    it("does not register the action tool when the real host port is absent", () => {
        const registry = createRegistry(createHost());

        expect(registry.has("manage_memory")).toBe(false);
        expect(registry.canExecute("manage_memory")).toMatchObject({ allowed: false });
    });

    it("returns a committed action receipt even when the request expires after commit", async () => {
        let current = true;
        const binding = { ...createBinding(), isCurrent: () => current };
        const execute = jest.fn<MemoryActionPort["execute"]>(async () => {
            current = false;
            return {
                kind: "memory-action",
                action: "remember",
                status: "applied",
                claimId: "claim-committed",
                revisionId: "revision-committed",
                eventId: "event-committed",
            };
        });
        const host = createHost({ execute });
        const registry = createRegistry(host);

        const result = await registry.execute("manage_memory", {
            action: "remember",
            userExpression: "remember that I prefer concise replies",
            content: "I prefer concise replies.",
            memoryType: "preference",
            sensitivity: "low",
        }, { host, memoryActionRequest: binding });

        expect(result.content).toMatchObject({
            status: "applied",
            claimId: "claim-committed",
        });
    });
});
