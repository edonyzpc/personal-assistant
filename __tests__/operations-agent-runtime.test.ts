import { describe, expect, it, jest } from "@jest/globals";
import { AIMessageChunk } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { App } from "obsidian";

import { AIUtils } from "../src/ai-services/ai-utils";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import type { AgentEvent, LegacyAgentEvent } from "../src/ai-services/chat-types";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { ChatService } from "../src/ai-services/chat-service";
import { PaAgentLoop } from "../src/ai-services/pa-agent-loop";
import type {
    PaAgentToolExecutionInput,
    PaAgentToolExecutor,
    ParsedBufferedToolCall,
} from "../src/ai-services/pa-agent-types";
import {
    type PaAgentRuntimeOptions,
    type PaAgentStreamOptions,
    PaAgentRuntime,
} from "../src/ai-services/pa-agent-runtime";
import { OperationsControllerError, OperationsIntentController } from "../src/ai-services/operations/operations-intent-controller";
import {
    OperationsSession,
} from "../src/ai-services/operations/operations-service";
import {
    createOperationsStagingToolExecutor,
} from "../src/ai-services/operations/operations-tool-executor";
import {
    OperationsToolCapability,
    OperationsToolProvider,
} from "../src/ai-services/operations/operations-tool-provider";
import {
    CORE_WRITE_TOOL_NAMES,
    type OperationsIntent,
    type OperationsVault,
    type OperationsVaultFile,
    type StageOperationsIntentInput,
} from "../src/ai-services/operations/types";
import {
    type BuiltinWebSearchRequest,
    BuiltinWebSearchProvider,
    createBailianWebSearchNetworkPolicy,
} from "../src/ai-services/builtin-web-search-provider";
import { revalidateVaultObservationFromApp } from "../src/ai-services/vault-observation-evidence";
import { createAiServiceHost } from "../src/tests/factories/host-factory";
import { WritingVersionService } from '../src/chat/writing-versions';

jest.mock("obsidian");

function deferredNames(providerInput: unknown): string[] {
    const text = String(providerInput);
    const start = text.indexOf("Deferred tools (");
    const end = text.indexOf("If you cannot complete");
    if (start < 0) return [];
    return [...text.slice(start, end > start ? end : undefined)
        .matchAll(/^- name: ([^\n]+)$/gm)].map(match => match[1]);
}

describe("Operations Agent direct runtime", () => {
    it("loads direct Operations and move without an execution handoff", async () => {
        const provider = new OperationsToolProvider();

        const loaded = await provider.load(providerContext());

        expect(loaded.status).toBe("available");
        expect(loaded.capabilities.map((capability) => capability.name))
            .toEqual([...CORE_WRITE_TOOL_NAMES]);
        expect(loaded.capabilities.every((capability) => (
            capability.kind === "action"
            && capability.permission === "local-filesystem-write"
            && capability.requiresConfirmation === false
        ))).toBe(true);
        expect(loaded.capabilities.map((capability) => capability.name)).not.toContain("append_to_current_note");
        expect(loaded.capabilities.map((capability) => capability.name)).not.toContain("replace_selection");
        await expect(loaded.capabilities[0].execute({}, {
            host: {} as never,
        })).rejects.toThrow("must run through the Operations batch executor");
    });

    it("keeps actions undiscoverable unless the current run explicitly includes them", async () => {
        const registry = await operationsRegistry();

        expect(registry.listDefinitions()).toEqual([]);
        expect(registry.exportProviderSchemas()).toEqual([]);
        const visibleNames = CORE_WRITE_TOOL_NAMES.filter(name => registry.get(name)?.sdkOnly !== true);
        const definitionNames = registry.listDefinitions({ includeActions: true }).map(definition => definition.name);
        const schemaNames = registry.exportProviderSchemas({ includeActions: true }).map(schema => schema.function.name);
        expect(definitionNames).toEqual(visibleNames);
        expect(schemaNames).toEqual(visibleNames);
        const internal = registry.listCapabilities().filter(capability => capability.sdkOnly === true);
        expect(internal.map(capability => capability.name)).toEqual([
            "obsidian.vault.createText", "obsidian.vault.replaceText", "obsidian.vault.mkdir", "obsidian.vault.move",
            "obsidian.vault.trash", "obsidian.workspace.open", "obsidian.workspace.applyEdits", "obsidian.operations.undo",
        ]);
        for (const capability of internal) {
            expect(registry.get(capability.name)).toBe(capability);
            expect(registry.canExecute(capability.name).allowed).toBe(true);
            expect(definitionNames).not.toContain(capability.name);
            expect(schemaNames).not.toContain(capability.name);
        }
    });

    it("keeps protocol shape without publishing arbitrary Operations schema capacities", () => {
        const frontmatter = new OperationsToolCapability("frontmatter_update").inputSchema;
        const process = new OperationsToolCapability("vault_process").inputSchema;

        expect(frontmatter.additionalProperties).toBe(false);
        expect(process.additionalProperties).toBe(false);
        expect(frontmatter.required).toContain("mode");
        expect(process.required).toContain("mode");
        expect(JSON.stringify([frontmatter, process]))
            .not.toMatch(/"(?:maxLength|maxItems|maxProperties|maximum)":/);
    });

    it.each([
        ["default Chat staging", {}],
        ["explicit chat-with-actions", { runKind: "chat-with-actions" as const }],
    ])("proposes the four writes with a live controller (%s)", async (_label, policyOptions) => {
        const fixture = operationsRuntimeFixture("Create notes/new.md with # Result", [
            toolCall("create", "vault_create", { path: "notes/new.md", content: "# Result" }, 0),
        ], {
            policyOptions,
        });
        try {
            await fixture.run();

            expect(fixture.boundToolNames[0]).toContain("load_tools");
            const visibleWrites = (await fixture.operationsSession.provider.load(providerContext())).capabilities
                .filter(capability => capability.sdkOnly !== true).map(capability => capability.name);
            expect(deferredNames(fixture.providerInputs[0]))
                .toEqual(expect.arrayContaining(visibleWrites));
            expect(fixture.stageIntent).toHaveBeenCalledTimes(1);
            expect(fixture.executeIntent).toHaveBeenCalledTimes(1);
            expect(fixture.vault.create).toHaveBeenCalledTimes(1);
        } finally {
            fixture.dispose();
        }
    });

    it("keeps default Chat Operations actions available on a later turn", async () => {
        const fixture = operationsRuntimeFixture("Read notes/other.md, then create notes/result.md with the conclusion.", [
            toolCall("read", "read_note", { path: "notes/other.md" }, 0),
        ], {
            nextToolCalls: (_input, modelTurn) => modelTurn === 2
                ? [toolCall("create", "vault_create", { path: "notes/result.md", content: "Conclusion" }, 0)]
                : undefined,
        });
        try {
            await fixture.run();

            expect(fixture.boundToolNames[1]).toContain("load_tools");
            const visibleWrites = (await fixture.operationsSession.provider.load(providerContext())).capabilities
                .filter(capability => capability.sdkOnly !== true).map(capability => capability.name);
            expect(deferredNames(fixture.providerInputs[1]))
                .toEqual(expect.arrayContaining(visibleWrites));
            expect(fixture.stageIntent).toHaveBeenCalledTimes(1);
            expect(fixture.executeIntent).toHaveBeenCalledTimes(1);
            expect(fixture.vault.create).toHaveBeenCalledTimes(1);
        } finally {
            fixture.dispose();
        }
    });

    it.each([false, true])("retains the real completed result in the next provider request (native authority change: %s)", async advanceAuthorityOnWrite => {
        const fixture = operationsRuntimeFixture("Create notes/new.md with # Result now.", [
            toolCall("create-current", "vault_create", { mode: "apply", path: "notes/new.md", content: "# Result" }, 0),
        ], { advanceAuthorityOnWrite, finalText: "Created notes/new.md." });
        try {
            await fixture.run();
            expect(fixture.stageIntent).toHaveBeenCalledTimes(1);
            expect(fixture.executeIntent).toHaveBeenCalledTimes(1);
            expect(fixture.vault.create).toHaveBeenCalledWith("notes/new.md", "# Result");
            const result = fixture.lifecycle.flatMap(event => event.type === "turn_end" ? event.toolResults ?? [] : [])
                .find(message => message.toolCallId === "create-current");
            expect(result?.content).toMatchObject({
                resultFact: { kind: "operations_result", observation: { state: "completed",
                    operations: [{ toolCallId: "create-current", status: "succeeded", receiptId: expect.any(String) }] } },
                metadata: { executionState: "succeeded", operationsOwnerResult: true },
            });
            expect(fixture.controller.listPendingIntents()).toEqual([]);
            expect(fixture.providerInputs).toHaveLength(2);
            const input = String(fixture.providerInputs[1]);
            expect(input).toContain('"callId":"create-current"');
            expect(input).toContain('"domainPhase":"completed"');
            expect(input).not.toContain("result_unknown");
            expect(input).not.toContain("- name: execute_operations");
            expect(fixture.legacyEvents).toContainEqual(expect.objectContaining({
                kind: "answer-snapshot", snapshot: "Created notes/new.md.",
            }));
        } finally { fixture.dispose(); }
    });

    it("keeps native move completion after the original source path disappears", async () => {
        const fixture = operationsRuntimeFixture("Move notes/current.md to notes/moved.md.", [
            toolCall("move-current", "vault_move", { mode: "apply", sourcePath: "notes/current.md", targetPath: "notes/moved.md" }, 0),
        ], { advanceAuthorityOnWrite: true, finalText: "Moved the note." });
        try {
            await fixture.run({ runSourceSelection: { schemaVersion: 1, scope: "notes",
                selectionId: "move-selection", userMessageId: "move-user" } });
            expect(fixture.renameFile).toHaveBeenCalledTimes(1);
            expect(fixture.vault.getAbstractFileByPath("notes/current.md")).toBeNull();
            expect(fixture.vault.getAbstractFileByPath("notes/moved.md")).not.toBeNull();
            const result = fixture.lifecycle.flatMap(event => event.type === "turn_end" ? event.toolResults ?? [] : [])
                .find(message => message.toolCallId === "move-current");
            expect(result?.content.resultFact).toMatchObject({ kind: "operations_result", observation: {
                state: "completed", operations: [{ toolCallId: "move-current", status: "succeeded" }],
            } });
            const next = String(fixture.providerInputs[1]);
            expect(next).toContain('"state":"completed"');
            expect(next).toContain('"toolCallId":"move-current"');
            expect(next).not.toContain("result_unknown");
            expect(fixture.lifecycle.at(-1)).toMatchObject({ type: "agent_end", status: "completed" });
        } finally { fixture.dispose(); }
    });

    it.each([undefined, "notes", "combined"] as const)("completes both legal creates after its own native authority changes (scope: %s)", async scope => {
        let fixture: ReturnType<typeof operationsRuntimeFixture>;
        fixture = operationsRuntimeFixture("Create both requested notes now.", [
            toolCall("create-first", "vault_create", { path: "notes/first.md", content: "First" }, 0),
            toolCall("create-second", "vault_create", { path: "notes/second.md", content: "Second" }, 1),
        ], {
            advanceAuthorityOnWrite: true,
            finalText: "Both notes were created.",
        });
        const execute = fixture.operationsSession.executeCurrentIntent.bind(fixture.operationsSession);
        const guardChecks: unknown[] = [];
        let guard: Parameters<typeof execute>[0]["taskSourceReadGuard"] | undefined;
        jest.spyOn(fixture.operationsSession, "executeCurrentIntent").mockImplementation(input => {
            guard = input.taskSourceReadGuard;
            guardChecks.push({ point: "before", current: guard.isCurrent(), authority: guard.captureSourceAuthority?.()() });
            return execute(input);
        });
        const create = fixture.vault.create.getMockImplementation();
        if (!create) throw new Error("Missing native create fixture");
        fixture.vault.create.mockImplementation(async (path, content) => {
            const file = await create(path, content);
            guardChecks.push({ point: "after", current: guard?.isCurrent(), authority: guard?.captureSourceAuthority?.()() });
            return file;
        });
        try {
            await fixture.run(scope ? { runSourceSelection: { schemaVersion: 1, scope,
                selectionId: "legal-batch-selection", userMessageId: "legal-batch-user" } } : {});
            expect(guardChecks).toEqual([{ point: "before", current: true, authority: true },
                { point: "after", current: false, authority: true },
                { point: "after", current: false, authority: true }]);
            expect(await fixture.executeIntent.mock.results[0]?.value).toMatchObject({ state: "completed",
                operations: [{ status: "succeeded" }, { status: "succeeded" }] });
            const result = fixture.lifecycle.flatMap(event => event.type === "turn_end" ? event.toolResults ?? [] : [])
                .find(message => message.toolName === "vault_create");
            expect(result?.content).toMatchObject({ resultFact: { kind: "operations_result", observation: { state: "completed" } },
                metadata: { executionState: "succeeded" } });
            expect(fixture.vault.getAbstractFileByPath("notes/first.md")).not.toBeNull();
            expect(fixture.vault.getAbstractFileByPath("notes/second.md")).not.toBeNull();
            expect(fixture.vault.create).toHaveBeenCalledTimes(2);
            const next = String(fixture.providerInputs[1]);
            expect(next).toContain('"callId":"create-second"');
            expect(next).toContain('"toolCallId":"create-second","status":"succeeded"');
            expect(next).not.toContain('result_unknown');
        } finally { fixture.dispose(); }
    });

    it("reports actual partial Operations effects when the next target is revoked after the first native write", async () => {
        const excludedPaths: string[] = [];
        let fixture: ReturnType<typeof operationsRuntimeFixture>;
        fixture = operationsRuntimeFixture("Create both requested notes now.", [
            toolCall("create-first", "vault_create", { path: "notes/first.md", content: "First" }, 0),
            toolCall("create-second", "vault_create", { path: "notes/second.md", content: "Second" }, 1),
        ], {
            advanceAuthorityOnWrite: true,
            excludedPaths,
            finalText: "The first note was created; the second result needs verification.",
        });
        const create = fixture.vault.create.getMockImplementation();
        if (!create) throw new Error("Missing native create fixture");
        fixture.vault.create.mockImplementationOnce(async (path, content) => {
            const file = await create(path, content);
            excludedPaths.push("notes/second.md");
            return file;
        });
        try {
            await fixture.run();
            const result = fixture.lifecycle.flatMap(event => event.type === "turn_end" ? event.toolResults ?? [] : [])
                .find(message => message.toolName === "vault_create");
            expect(result?.content).toMatchObject({
                resultFact: { kind: "operations_result", observation: { state: "partial" } },
                metadata: { executionState: "succeeded" },
            });
            expect(result?.content.metadata?.preflightOnly).toBeUndefined();
            expect(fixture.vault.getAbstractFileByPath("notes/first.md")).not.toBeNull();
            expect(fixture.vault.getAbstractFileByPath("notes/second.md")).toBeNull();
            expect(fixture.vault.create).toHaveBeenCalledTimes(1);
            expect(fixture.executeIntent).toHaveBeenCalledTimes(1);
            expect(await fixture.executeIntent.mock.results[0].value).toMatchObject({ state: "partial", operations: [
                { status: "succeeded" }, { status: "skipped" },
            ] });
            const next = String(fixture.providerInputs[1]);
            expect(next).toContain('"toolCallId":"create-first","status":"succeeded"');
            expect(next).toContain('"toolCallId":"create-second","status":"skipped"');
            expect(next).not.toContain('result_unknown');
        } finally { fixture.dispose(); }
    });

    it.each([
        ["explicit read-only chat", { runKind: "chat" as const }],
        ["explicit review runtime", { runKind: "review" as const }],
        ["explicit allowWrite=false", { allowWrite: false }],
        ["write permission excluded", {
            runKind: "chat-with-actions" as const,
            allowWrite: true,
            allowedActionPermissions: [],
        }],
    ])("does not grant Chat writes through a stricter caller policy (%s)", async (_label, policyOptions) => {
        const fixture = operationsRuntimeFixture("Create notes/new.md with # Result", [
            toolCall("create", "vault_create", { path: "notes/new.md", content: "# Result" }, 0),
        ], {
            policyOptions,
        });
        try {
            await fixture.run();

            expect(fixture.boundToolNames[0]).not.toContain("vault_create");
            expect(fixture.boundToolNames[0]).not.toContain("vault_append");
            expect(fixture.stageIntent).not.toHaveBeenCalled();
            expect(fixture.vault.create).not.toHaveBeenCalled();
        } finally {
            fixture.dispose();
        }
    });

    it("keeps writes unavailable when the staging controller is absent", async () => {
        const fixture = operationsRuntimeFixture("Create notes/new.md with # Result", [
            toolCall("create", "vault_create", { path: "notes/new.md", content: "# Result" }, 0),
        ], {
            operationsController: false,
        });
        try {
            await fixture.run();

            expect(fixture.boundToolNames[0]).not.toContain("vault_create");
            expect(fixture.boundToolNames[0]).not.toContain("vault_append");
            expect(fixture.stageIntent).not.toHaveBeenCalled();
            expect(fixture.vault.create).not.toHaveBeenCalled();
        } finally {
            fixture.dispose();
        }
    });

    it("keeps writes unavailable when the Operations host lifecycle is unavailable", async () => {
        const fixture = operationsRuntimeFixture("Create notes/new.md with # Result", [
            toolCall("create", "vault_create", { path: "notes/new.md", content: "# Result" }, 0),
        ], {
            operationsHostUnavailable: true,
        });
        try {
            await fixture.run();

            expect(fixture.boundToolNames[0]).not.toContain("vault_create");
            expect(fixture.boundToolNames[0]).not.toContain("vault_append");
            expect(fixture.stageIntent).not.toHaveBeenCalled();
            expect(fixture.vault.create).not.toHaveBeenCalled();
        } finally {
            fixture.dispose();
        }
    });

    it('keeps a real staged preview available without implicit execution', async () => {
        const fixture = operationsRuntimeFixture('Create notes/new.md with # Result', [
            toolCall('create', 'vault_create', { mode: 'preview', path: 'notes/new.md', content: '# Result' }, 0),
        ]);
        const versions = new WritingVersionService({ getWritingVersion: async () => null,
            putWritingVersion: async () => undefined, listWritingVersions: async () => [] });
        const prepare = jest.fn(async () => ({ context: '', revisionIds: [], isCurrent: () => true }));
        try {
            await fixture.run({ writingRequest: { requestId: 'writing-request' }, writingOutputProtocol: 'native',
                writingContextHost: { conversationId: 'writing-conversation', candidates: [], versions,
                    styles: { prepare }, isCurrent: () => true, isParentCurrent: () => true },
                chatHistory: [{ role: 'user', content: 'OLD_PENDING_STALE_27' },
                    { role: 'assistant', content: 'OLD_PENDING_ANSWER_27' }] });
            expect(fixture.providerInputs).toHaveLength(2);
            expect(fixture.boundToolNames[0]).toContain('get_writing_context');
            expect(fixture.boundToolNames[1]).not.toContain('execute_operations');
            expect(deferredNames(fixture.providerInputs[1])).not.toContain('execute_operations');
            expect(prepare).not.toHaveBeenCalled();
            expect(fixture.stageIntent).toHaveBeenCalledTimes(1);
            expect(fixture.executeIntent).not.toHaveBeenCalled();
            expect(fixture.vault.create).not.toHaveBeenCalled();
        } finally { fixture.dispose(); versions.dispose(); }
    });

    it("aborts batch staging at the tool timeout before an intent can be stored", async () => {
        const registry = await operationsRegistry();
        let stagingSignal: AbortSignal | undefined;
        const stageIntent = jest.fn((_input: StageOperationsIntentInput, signal?: AbortSignal) => {
            stagingSignal = signal;
            return new Promise<OperationsIntent>((_resolve, reject) => {
                signal?.addEventListener("abort", () => {
                    const error = new Error("staging aborted");
                    error.name = "AbortError";
                    reject(error);
                }, { once: true });
            });
        });
        const baseExecute = jest.fn(async () => ({
            outcome: "success" as const,
            promptText: "base",
        }));
        const executor = createOperationsStagingToolExecutor({
            baseExecutor: { execute: baseExecute },
            registry,
            controller: { stageIntent },
        });
        const loop = new PaAgentLoop({
            runId: "run-timeout",
            userInput: "save this conclusion",
            model: {
                stream: async function* () {
                    yield {
                        type: "toolcall_delta",
                        id: "call-timeout",
                        name: "vault_create",
                        input: { mode: "apply", path: "0.unsorted/timeout.md", content: "pending" },
                        index: 0,
                    } as const;
                },
            },
            toolExecutor: executor,
            toolExecutionMode: "hybrid",
            toolTimeoutMs: 5,
            hostPolicy: { afterTurn: () => ({ action: "stop", status: "completed", reason: "test" }) },
        });

        const result = await loop.run();

        expect(stageIntent).toHaveBeenCalledTimes(1);
        expect(stagingSignal?.aborted).toBe(true);
        expect(baseExecute).not.toHaveBeenCalled();
        expect(result.turns[0].diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "tool_batch_prepare_timeout", timeoutMs: 5 }),
        ]));
        expect(result.turns[0].toolResults[0].content.metadata).toMatchObject({
            reason: "operations_batch_required",
            wrote: false,
        });
    });

    it("propagates user abort into batch staging and stops before individual dispatch", async () => {
        const registry = await operationsRegistry();
        const abortController = new AbortController();
        let stagingSignal: AbortSignal | undefined;
        let markStagingStarted: (() => void) | undefined;
        const stagingStarted = new Promise<void>((resolve) => {
            markStagingStarted = resolve;
        });
        const stageIntent = jest.fn((_input: StageOperationsIntentInput, signal?: AbortSignal) => {
            stagingSignal = signal;
            markStagingStarted?.();
            return new Promise<OperationsIntent>((_resolve, reject) => {
                signal?.addEventListener("abort", () => {
                    const error = new Error("staging aborted");
                    error.name = "AbortError";
                    reject(error);
                }, { once: true });
            });
        });
        const baseExecute = jest.fn(async () => ({
            outcome: "success" as const,
            promptText: "base",
        }));
        const loop = new PaAgentLoop({
            runId: "run-abort",
            userInput: "save this conclusion",
            model: {
                stream: async function* () {
                    yield {
                        type: "toolcall_delta",
                        id: "call-abort",
                        name: "vault_create",
                        input: { mode: "apply", path: "0.unsorted/abort.md", content: "pending" },
                        index: 0,
                    } as const;
                },
            },
            toolExecutor: createOperationsStagingToolExecutor({
                baseExecutor: { execute: baseExecute },
                registry,
                controller: { stageIntent },
            }),
            toolExecutionMode: "hybrid",
            toolTimeoutMs: 1_000,
            signal: abortController.signal,
        });

        const running = loop.run();
        await stagingStarted;
        abortController.abort();
        const result = await running;

        expect(result.status).toBe("aborted");
        expect(stagingSignal?.aborted).toBe(true);
        expect(baseExecute).not.toHaveBeenCalled();
        expect(result.turns[0].diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "tool_batch_prepare_aborted" }),
        ]));
    });
});

describe("Operations-independent first-turn read capabilities", () => {
    it("exposes the fixed Memory action when the host action port is present", async () => {
        const prompt = "Remember that I prefer blue cards.";
        const fixture = operationsRuntimeFixture(prompt, [], {
            operationsController: false,
            memoryActions: true,
        });
        try {
            await fixture.run();
            expect(fixture.boundToolNames[0]).not.toContain("manage_memory");
            expect(fixture.boundToolNames[0]).toContain("load_tools");
            expect(deferredNames(fixture.providerInputs[0])).toContain("manage_memory");
        } finally {
            fixture.dispose();
        }
    });

    it("exposes and executes the approved first-turn read set without Memory-first or Operations gates", async () => {
        const fixture = operationsRuntimeFixture("Query notes/other.md, then read its saved body.", [
            toolCall("query", "query_notes", { path: "notes/other.md", limit: 1 }, 0),
            toolCall("read", "read_note", { path: "notes/other.md" }, 1),
        ], {
            operationsController: false,
            additionalCapabilityProviders: [availableWebSearchProvider()],
        });
        try {
            await fixture.run();

            const directNames = [
                "search_memory",
                "get_current_note_context",
                "query_notes",
                "read_note",
                "search_vault_metadata",
            ];
            const deferredExpectedNames = [
                "list_recent_notes",
                "read_note_outline",
                "inspect_obsidian_note",
                "read_canvas_summary",
                "search_vault_snippets",
                "list_vault_tags",
                "webSearch",
            ];
            expect(fixture.boundToolNames[0]).toEqual(expect.arrayContaining(directNames));
            expect(fixture.boundToolNames[0]).not.toContain("webSearch");
            expect(fixture.boundToolNames[0]).toContain("load_tools");
            expect(deferredNames(fixture.providerInputs[0]))
                .toEqual(expect.arrayContaining(deferredExpectedNames));
            expect(fixture.boundToolNames[0]).not.toContain("vault_create");
            expect(fixture.boundToolNames[0]).not.toContain("declare_source_scope");
            expect(fixture.boundToolNames[0]).not.toContain("request_source_decision");
            expect(fixture.lifecycle).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: "tool_execution_end", toolCallId: "query", outcome: "success",
                }),
                expect.objectContaining({
                    type: "tool_execution_end", toolCallId: "read", outcome: "success",
                }),
            ]));
            expect(fixture.vault.getMarkdownFiles).toHaveBeenCalled();
            expect(fixture.vault.cachedRead).toHaveBeenCalledWith(expect.objectContaining({
                path: "notes/other.md",
            }));
        } finally {
            fixture.dispose();
        }
    });

    it("does not advertise an additional provider capability when its real preload is unavailable", async () => {
        const fixture = operationsRuntimeFixture("Read notes/other.md.", [
            toolCall("read", "read_note", { path: "notes/other.md" }, 0),
        ], {
            operationsController: false,
            additionalCapabilityProviders: [new BuiltinWebSearchProvider({
                policy: createBailianWebSearchNetworkPolicy(),
                apiKey: undefined,
                request: webSearchRequest(),
            })],
        });
        try {
            await fixture.run();

            expect(fixture.boundToolNames[0]).not.toContain("webSearch");
            expect(String(fixture.providerInputs[0])).not.toContain('"webSearch"');
            expect(fixture.lifecycle).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    type: "tool_execution_end", toolCallId: "read", outcome: "success",
                }),
            ]));
        } finally {
            fixture.dispose();
        }
    });
});

describe("Operations runtime task source admission", () => {
    it("previews a create-then-append batch without a source declaration or writes", async () => {
        const prompt = "不要读取现有笔记。新建 notes/new.md，内容为 # Draft，然后追加 Final。";
        const fixture = operationsRuntimeFixture(prompt, [
            toolCall("create", "vault_create", { mode: "preview", path: "notes/new.md", content: "# Draft" }, 0),
            toolCall("append", "vault_append", { mode: "preview", path: "notes/new.md", content: "Final" }, 1),
        ]);
        try {
            await fixture.run();

            expect(fixture.boundToolNames[0]).toContain("load_tools");
            expect(deferredNames(fixture.providerInputs[0]))
                .toEqual(expect.arrayContaining(["vault_create", "vault_append"]));
            expect(fixture.boundToolNames[0]).not.toContain("declare_source_scope");
            expect(fixture.stageIntent).toHaveBeenCalledTimes(1);
            const [intent] = fixture.controller.listPendingIntents();
            expect(intent).toMatchObject({
                state: "pending",
                operations: [
                    { toolCallId: "create", expectedBefore: null, expectedAfter: "# Draft" },
                    { toolCallId: "append", expectedBefore: "# Draft", expectedAfter: "# Draft\nFinal" },
                ],
            });
            expect(intent).not.toHaveProperty("taskSourceReadGuard");
            expect(fixture.lifecycle).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: "tool_execution_end", toolCallId: "create", outcome: "success", metadata: expect.objectContaining({ contentMetadata: expect.objectContaining({ mode: "preview", wrote: false }) }) }),
                expect.objectContaining({ type: "tool_execution_end", toolCallId: "append", outcome: "success", metadata: expect.objectContaining({ contentMetadata: expect.objectContaining({ mode: "preview", wrote: false }) }) }),
                expect.objectContaining({ type: "agent_end", status: "completed" }),
            ]));
            expect(fixture.vault.adapter.exists).toHaveBeenCalledWith("notes/new.md");
            expectNoSourceReadsOrWrites(fixture);
        } finally {
            fixture.dispose();
        }
    });

    it("rejects the complete batch when append would read a Data Boundary excluded note", async () => {
        const prompt = "新建 notes/new.md，并向 notes/other.md 追加结论。";
        const fixture = operationsRuntimeFixture(prompt, [
            toolCall("create", "vault_create", { path: "notes/new.md", content: "Conclusion" }, 0),
            toolCall("append", "vault_append", { path: "notes/other.md", content: "Conclusion" }, 1),
        ], { excludedPaths: ["notes/other.md"] });
        try {
            await fixture.run();

            expect(fixture.stageIntent).not.toHaveBeenCalled();
            expect(fixture.controller.listPendingIntents()).toEqual([]);
            for (const toolCallId of ["create", "append"]) {
                expect(fixture.lifecycle).toContainEqual(expect.objectContaining({
                    type: "tool_execution_end", toolCallId, outcome: "policy_rejected",
                    metadata: expect.objectContaining({ contentMetadata: expect.objectContaining({ reason: "source_excluded" }) }),
                }));
            }
            expect(fixture.vault.adapter.exists).not.toHaveBeenCalled();
            expectNoSourceReadsOrWrites(fixture);
        } finally {
            fixture.dispose();
        }
    });

    it("publishes a returned context-used note handle and permits a later read without declaration", async () => {
        const prompt = "查阅另一篇笔记的标题结构，然后继续读取完整标题结构。";
        let discoveredHandle: string | undefined;
        const fixture = operationsRuntimeFixture(prompt, [
            toolCall("outline-first", "read_note_outline", { path: "notes/other.md", max_headings: 1 }, 0),
        ], {
            outlineHeadings: [
                { level: 1, heading: "Returned outline fact" },
                { level: 2, heading: "Scoped follow-up fact" },
            ],
            nextToolCalls: (input, modelTurn) => {
                if (modelTurn !== 2) return undefined;
                discoveredHandle = readProviderNoteDirectory(input).notes
                    .find(note => note.path === "notes/other.md")?.handle;
                if (!discoveredHandle) return undefined;
                return [
                    toolCall("outline-selected", "read_note_outline", { path: "notes/other.md", max_headings: 2 }, 0),
                ];
            },
            finalText: "这篇笔记包含 Returned outline fact 和 Scoped follow-up fact 两个标题。",
        });
        try {
            await fixture.run();

            expect(fixture.providerInputs).toHaveLength(3);
            const directories = fixture.providerInputs.map(readProviderNoteDirectory);
            expect(directories[0].notes.map(note => note.path)).toEqual(["notes/current.md"]);
            expect(discoveredHandle).toEqual(expect.any(String));
            expect(directories[1].notes).toContainEqual({ path: "notes/other.md", handle: discoveredHandle });
            expect(directories[2].notes).toContainEqual({ path: "notes/other.md", handle: discoveredHandle });

            const toolMessages = fixture.lifecycle.flatMap(event => (
                event.type === "message_end" && event.message.role === "toolResult" ? [event.message] : []
            ));
            const initialRead = toolMessages.find(message => message.toolCallId === "outline-first");
            const selectedRead = toolMessages.find(message => message.toolCallId === "outline-selected");
            expect(initialRead).toMatchObject({ isError: false, content: {
                includeInNextPrompt: true,
                sourceRecords: [{ kind: "context-used", path: "notes/other.md", citationEligible: false }],
            } });
            expect(initialRead?.content.promptText).toContain("Returned outline fact");
            expect(initialRead?.content.promptText).not.toContain("Scoped follow-up fact");
            expect(selectedRead).toMatchObject({ isError: false, content: {
                includeInNextPrompt: true,
                sourceRecords: [{ kind: "context-used", path: "notes/other.md", citationEligible: false }],
            } });
            expect(selectedRead?.content.promptText).toContain("Scoped follow-up fact");
            expect(toolMessages.some(message => message.toolName === "declare_source_scope")).toBe(false);
            expect(fixture.getFileCache.mock.calls.map(([file]) => file.path)).toEqual([
                "notes/other.md", "notes/other.md",
            ]);
            expect(fixture.vault.getMarkdownFiles).not.toHaveBeenCalled();
            expect(fixture.vault.cachedRead).not.toHaveBeenCalled();
            expect(fixture.vault.read).not.toHaveBeenCalled();
            expect(fixture.stageIntent).not.toHaveBeenCalled();
            expect(fixture.executeIntent).not.toHaveBeenCalled();
            expect(fixture.vault.create).not.toHaveBeenCalled();
            expect(fixture.vault.process).not.toHaveBeenCalled();
            expect(fixture.trashFile).not.toHaveBeenCalled();
        } finally {
            fixture.dispose();
        }
    });

    it("keeps a linked note in the next directory after reading the current outline", async () => {
        const fixture = operationsRuntimeFixture("先读当前笔记，再读它链接的复盘", [
            toolCall("outline-current", "read_note_outline", { path: "notes/current.md" }, 0),
        ], {
            linkedNotePath: "notes/other.md",
            outlineHeadings: [{ level: 1, heading: "Current outline" }],
            nextToolCalls: (input, modelTurn) => modelTurn === 2
                && readProviderNoteDirectory(input).notes.some(note => note.path === "notes/other.md")
                ? [toolCall("read-linked", "read_note", { path: "notes/other.md" }, 0)] : undefined,
            finalText: "已根据当前笔记与链接复盘回答。",
        });
        try {
            await fixture.run();
            expect(fixture.providerInputs).toHaveLength(3);
            expect(readProviderNoteDirectory(fixture.providerInputs[1]).notes)
                .toEqual(expect.arrayContaining([expect.objectContaining({ path: "notes/other.md" })]));
            expect(fixture.lifecycle).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: "tool_execution_end", toolCallId: "read-linked", outcome: "success" }),
                expect.objectContaining({ type: "agent_end", status: "completed" }),
            ]));
        } finally {
            fixture.dispose();
        }
    });

    it("completes the accepted ordinary answer when a used note is excluded after the final provider request", async () => {
        const excludedPaths: string[] = [];
        const finalText = "PRIVATE OTHER NOTE BODY informs this answer.";
        const fixture = operationsRuntimeFixture("Read the other note and answer", [
            toolCall("read-other", "read_note_outline", { path: "notes/other.md" }, 0),
        ], {
            excludedPaths,
            outlineHeadings: [{ level: 1, heading: "Other fact" }],
            finalText,
            onFinalAnswerRequest: () => excludedPaths.push("notes/other.md"),
        });
        try {
            await fixture.run();
            expect(fixture.providerInputs).toHaveLength(2);
            expect(fixture.lifecycle).toContainEqual(expect.objectContaining({
                type: "turn_end", status: "completed",
            }));
            expect(fixture.lifecycle).toContainEqual(expect.objectContaining({
                type: "agent_end", status: "completed",
            }));
            expect(JSON.stringify(fixture.lifecycle)).toContain(finalText);
            expect(JSON.stringify(fixture.lifecycle)).not.toContain('assistant_source_changed');
        } finally {
            fixture.dispose();
        }
    });

    it("keeps an ordinary answer valid after a same-file content edit", async () => {
        const fixture = operationsRuntimeFixture("Read the other note and answer", [
            toolCall("read-other", "read_note_outline", { path: "notes/other.md" }, 0),
        ], {
            outlineHeadings: [{ level: 1, heading: "Other fact" }],
            finalText: "The earlier note snapshot contained Other fact.",
            onFinalAnswerRequest: () => {
                fixture.otherFile.stat.mtime += 1;
            },
        });
        try {
            await fixture.run();
            expect(fixture.providerInputs).toHaveLength(2);
            expect(fixture.lifecycle).toContainEqual(expect.objectContaining({
                type: "agent_end", status: "completed",
            }));
        } finally {
            fixture.dispose();
        }
    });

    it("never projects a current-note link alias under the linked target identity", async () => {
        const excludedPaths: string[] = [];
        const alias = "SENSITIVE CURRENT NOTE ALIAS";
        const fixture = operationsRuntimeFixture("Read the linked note", [
            toolCall("read-other", "read_note_outline", { path: "notes/other.md" }, 0),
        ], {
            excludedPaths,
            linkedNotePath: "notes/other.md",
            linkedNoteAlias: alias,
            outlineHeadings: [{ level: 1, heading: "Public target fact" }],
            onToolCacheRead: path => {
                if (path === "notes/other.md") excludedPaths.push("notes/current.md");
            },
            finalText: "The linked note has Public target fact.",
        });
        try {
            await fixture.run();
            expect(fixture.providerInputs).toHaveLength(2);
            const directory = readProviderNoteDirectory(fixture.providerInputs[1]);
            expect(directory.currentNoteHandle).toBeNull();
            expect(directory.notes).toEqual(expect.arrayContaining([
                expect.objectContaining({ path: "notes/other.md" }),
            ]));
            expect(JSON.stringify(fixture.providerInputs)).not.toContain(alias);
            expect(fixture.lifecycle).toContainEqual(expect.objectContaining({
                type: "agent_end", status: "completed",
            }));
        } finally {
            fixture.dispose();
        }
    });

    it('lets the Agent explicitly report an unfinished excluded-source task', async () => {
        const explanation = 'I cannot answer from the excluded current note.';
        const fixture = operationsRuntimeFixture('Answer from the current note', [
            toolCall('read-current', 'get_current_note_context', {}, 0),
        ], {
            excludedPaths: ['notes/current.md'],
            nextToolCalls: (_input, modelTurn) => modelTurn === 2
                ? [toolCall('report', 'report_task_incomplete', { answer: explanation }, 0)] : undefined,
        });
        try {
            await fixture.run();
            expect(fixture.boundToolNames[0]).toContain('report_task_incomplete');
            expect(JSON.stringify(fixture.providerInputs[0])).toContain('Do not print <report_task_incomplete>');
            expect(fixture.lifecycle).toContainEqual(expect.objectContaining({
                type: 'agent_end', status: 'incomplete',
                metadata: expect.objectContaining({ reason: 'agent_reported_incomplete' }),
            }));
            expect(fixture.lifecycle).toContainEqual(expect.objectContaining({
                type: 'turn_end', status: 'incomplete',
            }));
            expect(JSON.stringify(fixture.lifecycle)).toContain(explanation);
            expect(fixture.legacyEvents).toContainEqual(expect.objectContaining({
                kind: 'answer-snapshot', snapshot: explanation,
            }));
            expect(fixture.vault.cachedRead).not.toHaveBeenCalled();
        } finally {
            fixture.dispose();
        }
    });
});

interface OperationsRuntimeFixtureOptions {
    advanceAuthorityOnWrite?: boolean;
    outlineHeadings?: Array<{ level: number; heading: string }>;
    linkedNotePath?: string;
    linkedNoteAlias?: string;
    onToolCacheRead?: (path: string) => void;
    onFinalAnswerRequest?: () => void;
    nextToolCalls?: (input: unknown, modelTurn: number) => readonly ParsedBufferedToolCall[] | undefined;
    finalText?: string;
    operationsHostUnavailable?: boolean;
    operationsController?: boolean;
    memoryActions?: boolean;
    additionalCapabilityProviders?: PaAgentRuntimeOptions["additionalCapabilityProviders"];
    policyOptions?: PaAgentRuntimeOptions["policyOptions"];
    excludedPaths?: readonly string[];
}

function operationsRuntimeFixture(
    prompt: string,
    calls: readonly ParsedBufferedToolCall[],
    fixtureOptions: OperationsRuntimeFixtureOptions = {},
) {
    const currentFile = {
        path: "notes/current.md",
        extension: "md",
        stat: { ctime: 1, mtime: 2, size: 25 },
    };
    const otherFile = {
        path: "notes/other.md",
        extension: "md",
        stat: { ctime: 3, mtime: 4, size: 23 },
    };
    const fileObjects = new Map<string, OperationsVaultFile>([
        [currentFile.path, currentFile], [otherFile.path, otherFile],
        ["notes", { path: "notes", children: [] }],
    ]);
    const oldContents = new Map([
        [currentFile.path, "PRIVATE CURRENT NOTE BODY"],
        [otherFile.path, "PRIVATE OTHER NOTE BODY"],
    ]);
    let authorityEpoch = 0;
    const vault = {
        getAbstractFileByPath: jest.fn((path: string) => fileObjects.get(path) ?? null),
        getMarkdownFiles: jest.fn(() => [currentFile, otherFile]),
        cachedRead: jest.fn(async (file: OperationsVaultFile) => oldContents.get(file.path) ?? ""),
        read: jest.fn(async (file: OperationsVaultFile) => oldContents.get(file.path) ?? ""),
        create: jest.fn(async (path: string, content: string) => {
            const file = { path, extension: "md", stat: { ctime: 1, mtime: 1, size: content.length } };
            fileObjects.set(path, file);
            oldContents.set(path, content);
            if (fixtureOptions.advanceAuthorityOnWrite) authorityEpoch += 1;
            return file;
        }),
        process: jest.fn(async (file: OperationsVaultFile, change: (text: string) => string) => {
            oldContents.set(file.path, change(oldContents.get(file.path) ?? ""));
            if (fixtureOptions.advanceAuthorityOnWrite) authorityEpoch += 1;
        }),
        adapter: { exists: jest.fn(async (path: string) => fileObjects.has(path)) },
    } satisfies OperationsVault & { getMarkdownFiles(): OperationsVaultFile[] };
    const trashFile = jest.fn(async (_file: OperationsVaultFile) => undefined);
    const renameFile = jest.fn(async (file: OperationsVaultFile, targetPath: string) => {
        const content = oldContents.get(file.path) ?? "";
        fileObjects.delete(file.path); oldContents.delete(file.path);
        file.path = targetPath;
        fileObjects.set(targetPath, file); oldContents.set(targetPath, content);
        if (fixtureOptions.advanceAuthorityOnWrite) authorityEpoch += 1;
    });
    const controller = new OperationsIntentController({ vault, trashFile, renameFile,
        isPathAllowed: path => !fixtureOptions.excludedPaths?.includes(path) });
    const operationsSession = new OperationsSession({
        controller,
        isOperationsAgentEnabled: () => fixtureOptions.operationsHostUnavailable !== true,
        capabilityProvider: new OperationsToolProvider(),
        readContextResult: (intentId, runId) => controller.getContextResult(intentId, runId),
        onDispose: () => undefined,
    });
    const stageIntent = jest.spyOn(controller, "stageIntent");
    const executeIntent = jest.spyOn(controller, "executeIntent");
    const getFileCache = jest.fn((file: OperationsVaultFile) => {
        fixtureOptions.onToolCacheRead?.(file.path);
        return fixtureOptions.outlineHeadings
            ? { headings: fixtureOptions.outlineHeadings }
            : { frontmatter: { status: "active" } };
    });
    const host = createAiServiceHost({
        settings: { memoryEnabled: false },
        app: {
            vault,
            workspace: {
                getActiveViewOfType: () => ({ file: currentFile }),
                getMostRecentLeaf: () => null,
                getLeavesOfType: () => [],
            },
            metadataCache: {
                getFileCache,
                getCache: (path: string) => path === currentFile.path && fixtureOptions.linkedNotePath
                    ? { links: [{ link: fixtureOptions.linkedNotePath,
                        ...(fixtureOptions.linkedNoteAlias ? { displayText: fixtureOptions.linkedNoteAlias } : {}) }] } : null,
                getFirstLinkpathDest: (link: string) => link === otherFile.path ? otherFile : null,
            },
        } as unknown as App,
        isDataBoundaryAllowedPath: (path: string) => !fixtureOptions.excludedPaths?.includes(path),
        isOperationsAgentEnabled: fixtureOptions.operationsHostUnavailable !== true,
    });
    Object.assign(host, {
        ...(fixtureOptions.advanceAuthorityOnWrite ? { getTaskSourceAuthorityEpoch: () => String(authorityEpoch) } : {}),
        revalidateVaultObservation: (
            evidence: Parameters<typeof revalidateVaultObservationFromApp>[1],
            options?: Parameters<typeof revalidateVaultObservationFromApp>[2],
        ) => revalidateVaultObservationFromApp(host, evidence, options),
    });
    const chatService = new ChatService(host, operationsSession);
    if (fixtureOptions.memoryActions) {
        Object.assign(host, { memoryActions: { execute: jest.fn(async () => ({ status: "applied" })) } });
    }
    const aiUtils = new AIUtils(host);
    const boundToolNames: string[][] = [];
    const providerInputs: unknown[] = [];
    let modelTurn = 0;
    const createModel = jest.spyOn(aiUtils, "createChatModel").mockImplementation(async (_temperature, options) => {
        const model = RunnableLambda.from(async function* (input: unknown) {
            options?.onProviderRequestStart?.();
            providerInputs.push(input);
            modelTurn += 1;
            const turnCalls = modelTurn === 1 ? calls : fixtureOptions.nextToolCalls?.(input, modelTurn);
            if (turnCalls) {
                yield new AIMessageChunk({ content: "", tool_call_chunks: turnCalls.map(call => ({
                    id: call.id, name: call.name, index: call.index, args: JSON.stringify(call.input),
                })) });
                yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: "tool_calls" } });
                return;
            }
            fixtureOptions.onFinalAnswerRequest?.();
            yield new AIMessageChunk({ content: fixtureOptions.finalText ?? (controller.listPendingIntents().length
                ? "请确认这份修改提案；尚未写入笔记。"
                : "当前取材范围不允许读取该笔记，未暂存或执行修改。") });
            yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: "stop" } });
        });
        Object.assign(model, { bindTools: (schemas: Array<{ function: { name: string } }>) => {
            boundToolNames.push(schemas.map(schema => schema.function.name));
            return model;
        } });
        return model as unknown as Awaited<ReturnType<AIUtils["createChatModel"]>>;
    });
    const lifecycle: AgentEvent[] = [];
    const legacyEvents: LegacyAgentEvent[] = [];
    const runtime = new PaAgentRuntime(host, aiUtils, {
        skillContextProvider: null,
        operationsIntentController: fixtureOptions.operationsController === false ? undefined : operationsSession,
        operationsIntentExecutor: input => chatService.executeOperationsIntentFromAgent(input),
        maxModelTurns: 3,
        ...(fixtureOptions.additionalCapabilityProviders
            ? { additionalCapabilityProviders: fixtureOptions.additionalCapabilityProviders }
            : {}),
        ...(fixtureOptions.policyOptions ? { policyOptions: fixtureOptions.policyOptions } : {}),
    });
    return {
        vault, otherFile, trashFile, renameFile, controller, operationsSession, stageIntent, executeIntent, getFileCache,
        boundToolNames, providerInputs, lifecycle, legacyEvents,
        run: (outputOptions: Pick<PaAgentStreamOptions, 'writingRequest' | 'writingOutputProtocol'
            | 'writingContextHost' | 'chatHistory' | 'runSourceSelection'> = {}) => runtime.streamTurn({
            prompt, memoryMode: "auto", ...outputOptions, onLifecycleEvent: event => lifecycle.push(event),
            onEvent: event => legacyEvents.push(event),
        }),
        dispose: () => {
            runtime.dispose();
            chatService.dispose();
            createModel.mockRestore();
            stageIntent.mockRestore();
            executeIntent.mockRestore();
        },
    };
}

function readProviderNoteDirectory(input: unknown): {
    currentNoteHandle: string | null;
    notes: Array<{ path: string; handle: string }>;
} {
    const directory = String(input).split("\n").find(line => line.startsWith('{"currentNoteHandle":'));
    if (!directory) throw new Error("Provider input did not contain the host note directory.");
    return JSON.parse(directory);
}

function expectNoSourceReadsOrWrites(fixture: ReturnType<typeof operationsRuntimeFixture>): void {
    expect(fixture.vault.cachedRead).not.toHaveBeenCalled();
    expect(fixture.vault.read).not.toHaveBeenCalled();
    expect(fixture.getFileCache).not.toHaveBeenCalled();
    expect(fixture.executeIntent).not.toHaveBeenCalled();
    expect(fixture.vault.create).not.toHaveBeenCalled();
    expect(fixture.vault.process).not.toHaveBeenCalled();
    expect(fixture.trashFile).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.providerInputs)).not.toContain("PRIVATE CURRENT NOTE BODY");
    expect(JSON.stringify(fixture.providerInputs)).not.toContain("PRIVATE OTHER NOTE BODY");
}

function providerContext() {
    return {
        turnId: "turn-1",
        platform: "desktop" as const,
        settings: {},
    };
}

function webSearchRequest(): BuiltinWebSearchRequest {
    return async () => ({
        status: 200,
        body: { results: [] },
    });
}

function availableWebSearchProvider(): BuiltinWebSearchProvider {
    return new BuiltinWebSearchProvider({
        policy: createBailianWebSearchNetworkPolicy(),
        apiKey: "test-web-search-key",
        request: webSearchRequest(),
    });
}

async function operationsRegistry(): Promise<CapabilityRegistry> {
    const registry = new CapabilityRegistry({
        policyEngine: new PolicyEngine({
            platform: "desktop",
            runKind: "chat-with-actions",
            allowWrite: true,
            allowedActionPermissions: ["local-filesystem-write"],
        }),
    });
    const loaded = await new OperationsToolProvider().load(providerContext());
    registry.registerMany(loaded.capabilities);
    return registry;
}

function toolCall(
    id: string,
    name: string,
    input: unknown,
    index: number,
): ParsedBufferedToolCall {
    const args = CORE_WRITE_TOOL_NAMES.includes(name as never) && input && typeof input === "object"
        ? { mode: "apply", ...input } : input;
    return { type: "toolCall", id, name, input: args, index };
}
