import { describe, expect, it } from "@jest/globals";

import {
    OperationsIntentController,
} from "../src/ai-services/operations/operations-intent-controller";
import {
    OperationsReviewSession,
    type OperationsReviewSnapshot,
} from "../src/ai-services/operations/operations-review-session";
import type {
    OperationExecutionResult,
    OperationsControllerEvent,
    OperationsIntent,
    OperationsVault,
    OperationsVaultFile,
    PreparedOperation,
} from "../src/ai-services/operations/types";

class MemoryVault implements OperationsVault {
    readonly files = new Map<string, string>([["notes/a.md", "before"]]);
    readonly folders = new Set<string>(["notes"]);
    readonly adapter = {
        exists: async (path: string) => this.files.has(path) || this.folders.has(path),
        read: async (path: string) => {
            const content = this.files.get(path);
            if (content === undefined) throw new Error("missing");
            return content;
        },
    };

    readonly cachedRead = async (file: OperationsVaultFile): Promise<string> => {
        const content = this.files.get(file.path);
        if (content === undefined) throw new Error("missing");
        return content;
    };

    readonly create = async (path: string, content: string): Promise<OperationsVaultFile> => {
        this.files.set(path, content);
        return { path };
    };

    readonly process = async (
        file: OperationsVaultFile,
        transform: (current: string) => string,
    ): Promise<string> => {
        const current = this.files.get(file.path);
        if (current === undefined) throw new Error("missing");
        const next = transform(current);
        this.files.set(file.path, next);
        return next;
    };

    getAbstractFileByPath(path: string): OperationsVaultFile | null {
        if (this.files.has(path)) return { path, extension: "md" };
        if (this.folders.has(path)) return { path, children: [] };
        return null;
    }
}

function reviewIntent(id: string): OperationsIntent {
    const operation: PreparedOperation = {
        id: `${id}-operation`,
        toolCallId: `${id}-call`,
        name: "vault_append",
        input: { path: "notes/a.md", content: "\nafter" },
        path: "notes/a.md",
        expectedBefore: "before",
        expectedAfter: "before\nafter",
    };
    return {
        id,
        runId: `${id}-run`,
        turnId: `${id}-turn`,
        createdAt: 1,
        expiresAt: 2,
        operations: [operation],
        state: "pending",
    };
}

function makeFixture() {
    const vault = new MemoryVault();
    let id = 0;
    let current = true;
    const controller = new OperationsIntentController({
        vault,
        trashFile: async (file) => {
            vault.files.delete(file.path);
        },
        createId: () => `id-${++id}`,
        pendingTtlMs: 60_000,
    });
    const snapshots: OperationsReviewSnapshot[] = [];
    const onInvalidate = jest.fn();
    const makeSession = async (): Promise<OperationsReviewSession> => {
        const intent: OperationsIntent = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            mode: "apply",
            operations: [{
                toolCallId: "call",
                name: "vault_append",
                input: { path: "notes/a.md", content: "\nafter" },
            }],
        });
        const session = new OperationsReviewSession({
            intent,
            controller: {
                undoMany: async (receiptIds) => await controller.undoMany(receiptIds),
                subscribe: (listener) => controller.subscribe(listener),
            },
            sessionIdentity: "view-1",
            isSourceCurrent: () => current,
            onInvalidate,
        });
        snapshots.push(session.getSnapshot());
        session.subscribe(snapshot => snapshots.push(snapshot));
        return session;
    };
    return {
        vault,
        controller,
        makeSession,
        snapshots,
        onInvalidate,
        invalidateSource: () => { current = false; },
    };
}

describe("OperationsReviewSession", () => {
    it("observes direct execution without activation or a UI execution port", async () => {
        const fixture = makeFixture();
        const session = await fixture.makeSession();
        expect(fixture.vault.files.get("notes/a.md")).toBe("before");
        expect(session.canUndo()).toBe(false);
        const result = await fixture.controller.executeIntent(session.getSnapshot().intentId);
        expect(result.state).toBe("completed");
        expect(fixture.vault.files.get("notes/a.md")).toBe("before\nafter");
        expect(session.getSnapshot()).toMatchObject({ status: "completed", execution: result });
        expect(fixture.snapshots.some(snapshot => snapshot.status === "executing")).toBe(true);
        fixture.controller.dispose();
    });

    it("keeps Undo receipts one-time and shared across UI surfaces", async () => {
        const fixture = makeFixture();
        const chatSession = await fixture.makeSession();
        const fullViewSession = chatSession;
        await fixture.controller.executeIntent(chatSession.getSnapshot().intentId);
        const receiptId = fullViewSession.getSnapshot().operationResults[0]!.receiptId!;
        expect(fullViewSession.canUndo()).toBe(true);

        const first = fullViewSession.undo([receiptId]);
        const second = chatSession.undo([receiptId]);
        expect(await second).toBeNull();
        const undone = await first;
        expect(undone).toEqual([expect.objectContaining({ status: "undone" })]);
        expect(fixture.vault.files.get("notes/a.md")).toBe("before");
        expect(fullViewSession.activeReceiptIds()).toEqual([]);
        expect(fullViewSession.canUndo()).toBe(false);
        fixture.controller.dispose();
    });

    it("keeps preview and old pending history inert when opened or discarded", async () => {
        const intent = reviewIntent("preview");
        const undoMany = jest.fn(async () => []);
        const makeSession = (mode?: "preview") => new OperationsReviewSession({
            intent: { ...intent, mode }, controller: { undoMany },
            sessionIdentity: "preview", isSourceCurrent: () => true,
        });
        const preview = makeSession("preview");
        const historical = makeSession();
        expect(preview.getSnapshot().status).toBe("preview");
        expect(historical.getSnapshot().status).toBe("pending");
        expect(preview.activeReceiptIds()).toEqual([]);
        preview.discard();
        historical.discard();
        expect(undoMany).not.toHaveBeenCalled();
        expect(preview.getSnapshot().model).toBeNull();
    });

    it("clears frozen bodies and receipts when the source Chat session is invalidated", async () => {
        const fixture = makeFixture();
        const session = await fixture.makeSession();
        await fixture.controller.executeIntent(session.getSnapshot().intentId);
        const receiptId = session.getSnapshot().operationResults[0]!.receiptId!;
        expect(receiptId).toBeDefined();

        fixture.invalidateSource();
        session.invalidate("unavailable");

        const snapshot = session.getSnapshot();
        expect(snapshot).toMatchObject({
            status: "unavailable",
            model: null,
            execution: null,
            operationResults: [],
            undoResults: [],
        });
        await expect(session.undo([receiptId])).resolves.toBeNull();
        expect(fixture.vault.files.get("notes/a.md")).toBe("before\nafter");
        fixture.controller.dispose();
    });

    it("subscribes to actual controller lifecycle events", async () => {
        const vault = new MemoryVault();
        const events: OperationsControllerEvent[] = [];
        const controller = new OperationsIntentController({
            vault,
            trashFile: async (file) => {
                vault.files.delete(file.path);
            },
            pendingTtlMs: 60_000,
            onEvent: event => events.push(event),
        });
        const intent = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            mode: "apply",
            operations: [{
                toolCallId: "call",
                name: "vault_append",
                input: { path: "notes/a.md", content: "\nafter" },
            }],
        });
        const session = new OperationsReviewSession({
            intent,
            controller: {
                undoMany: async (receiptIds) => await controller.undoMany(receiptIds),
                subscribe: (listener) => controller.subscribe(listener),
            },
            sessionIdentity: "events",
            isSourceCurrent: () => true,
        });
        const seen: string[] = [];
        session.subscribe(snapshot => seen.push(snapshot.status));
        const result = await controller.executeIntent(intent.id);

        expect(events.map(event => event.type)).toEqual(expect.arrayContaining([
            "intent-state-changed",
            "operation-result",
            "intent-result",
        ]));
        expect(seen).toEqual(expect.arrayContaining(["executing", "completed"]));
        expect(session.getSnapshot()).toMatchObject({
            status: "completed",
            execution: result,
            operationResults: [expect.objectContaining({
                operationId: intent.operations[0]!.id,
                status: "succeeded",
                receiptId: expect.any(String),
            })],
        });
        expect(session.getSnapshot().operationResults).toEqual(result.operations);
        expect(vault.files.get("notes/a.md")).toBe("before\nafter");
        controller.dispose();
    });

    it("keeps partial receipts and shows a drift-safe Undo rejection", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/existing.md", "before");
        const controller = new OperationsIntentController({
            vault,
            trashFile: async (file) => {
                vault.files.delete(file.path);
            },
            pendingTtlMs: 60_000,
        });
        const port = {
            undoMany: async (receiptIds: readonly string[]) => await controller.undoMany(receiptIds),
            subscribe: (listener: (event: OperationsControllerEvent) => void) => controller.subscribe(listener),
        };
        const intent = await controller.stageIntent({
            mode: "apply",
            runId: "run-partial",
            turnId: "turn-partial",
            operations: [
                {
                    toolCallId: "create",
                    name: "vault_create",
                    input: { path: "notes/new.md", content: "created" },
                },
                {
                    toolCallId: "stale",
                    name: "vault_append",
                    input: { path: "notes/existing.md", content: "\nafter" },
                },
                {
                    toolCallId: "skipped",
                    name: "vault_append",
                    input: { path: "notes/existing.md", content: "\nlater" },
                },
            ],
        });
        const session = new OperationsReviewSession({
            intent,
            controller: port,
            sessionIdentity: "partial",
            isSourceCurrent: () => true,
        });
        vault.files.set("notes/existing.md", "user edit");
        const execution = await controller.executeIntent(intent.id);

        expect(execution?.state).toBe("partial");
        const snapshot = session.getSnapshot();
        expect(snapshot.operationResults.map(result => result.status)).toEqual(["succeeded", "stale", "skipped"]);
        expect(session.activeReceiptIds()).toHaveLength(1);

        vault.files.set("notes/new.md", "changed by user");
        const undoResults = await session.undo(session.activeReceiptIds());
        expect(undoResults?.[0]).toMatchObject({
            status: "stale",
            failureCategory: "stale_target",
        });
        const rejected = session.getSnapshot();
        expect(rejected.undoResults[0]).toMatchObject({ status: "stale" });
        expect(vault.files.get("notes/new.md")).toBe("changed by user");
        controller.dispose();
    });

    it("releases subscriptions, bodies, and receipts on controller disposal", async () => {
        const fixture = makeFixture();
        const originalSubscribe = fixture.controller.subscribe.bind(fixture.controller);
        const unsubscribeController = jest.fn();
        jest.spyOn(fixture.controller, "subscribe").mockImplementation(listener => {
            const unsubscribe = originalSubscribe(listener);
            return () => {
                unsubscribe();
                unsubscribeController();
            };
        });
        const session = await fixture.makeSession();
        await fixture.controller.executeIntent(session.getSnapshot().intentId);
        expect(session.canUndo()).toBe(true);
        fixture.controller.dispose();

        const snapshot = session.getSnapshot();
        expect(snapshot).toMatchObject({
            status: "unavailable",
            model: null,
            execution: null,
            operationResults: [],
            undoResults: [],
        });
        expect(session.canUndo()).toBe(false);
        expect(unsubscribeController).toHaveBeenCalledTimes(1);
        expect(fixture.onInvalidate).toHaveBeenCalledWith(session.reviewId);
    });

    it("does not restore a discarded batch when a native operation settles late", async () => {
        const vault = new MemoryVault();
        let releaseProcess!: (value: string) => void;
        (vault as unknown as {
            process: (file: OperationsVaultFile, transform: (current: string) => string) => Promise<string>;
        }).process = async (_file, transform) => {
            const current = vault.files.get("notes/a.md")!;
            await new Promise<string>(resolve => {
                releaseProcess = resolve;
            });
            return transform(current);
        };
        const controller = new OperationsIntentController({
            vault,
            trashFile: async (file) => {
                vault.files.delete(file.path);
            },
            pendingTtlMs: 60_000,
        });
        const intent = await controller.stageIntent({
            mode: "apply",
            runId: "run-deferred",
            turnId: "turn-deferred",
            operations: [{
                toolCallId: "call",
                name: "vault_append",
                input: { path: "notes/a.md", content: "\nafter" },
            }],
        });
        const session = new OperationsReviewSession({
            intent,
            controller: {
                undoMany: async (receiptIds) => await controller.undoMany(receiptIds),
                subscribe: (listener) => controller.subscribe(listener),
            },
            sessionIdentity: "deferred",
            isSourceCurrent: () => true,
        });
        const confirming = controller.executeIntent(intent.id);
        session.discard();
        releaseProcess("\nafter");
        const result = await confirming;

        expect(result).toMatchObject({ state: "completed" });
        expect(session.getSnapshot()).toMatchObject({
            status: "discarded",
            model: null,
            operationResults: [],
        });
        expect(session.canUndo()).toBe(false);
        controller.dispose();
    });

    it("accepts undo facts only for operations owned by this review batch", async () => {
        let emitControllerEvent: ((event: OperationsControllerEvent) => void) | undefined;
        const operation: OperationExecutionResult = {
            operationId: "owned-operation",
            toolCallId: "owned-call",
            name: "vault_append",
            path: "notes/a.md",
            status: "succeeded",
            receiptId: "owned-receipt",
        };
        const intent = reviewIntent("intent-ownership");
        const session = new OperationsReviewSession({
            intent,
            controller: {
                undoMany: async () => [],
                subscribe: listener => {
                    emitControllerEvent = listener;
                    return () => undefined;
                },
            },
            sessionIdentity: "ownership",
            isSourceCurrent: () => true,
        });
        emitControllerEvent?.({ type: "intent-result", result: { intentId: intent.id, state: "completed", operations: [operation] } });

        emitControllerEvent?.({
            type: "undo-result",
            result: {
                receiptId: "other-receipt",
                operationId: "other-operation",
                status: "undone",
            },
        });
        expect(session.getSnapshot().undoResults).toEqual([]);

        emitControllerEvent?.({
            type: "undo-result",
            result: {
                receiptId: "owned-receipt",
                operationId: "owned-operation",
                status: "stale",
                message: "cannot undo safely",
            },
        });
        expect(session.getSnapshot().undoResults).toEqual([
            expect.objectContaining({ operationId: "owned-operation", status: "stale" }),
        ]);
    });
});

describe("OperationsReviewSession request scope", () => {
    const requestIntent = (id: string, turnId: string, before: string, after: string): OperationsIntent => ({
        id,
        runId: "request-run",
        turnId,
        createdAt: 1,
        expiresAt: 2,
        state: "pending",
        operations: [{
            id: `${id}-operation`,
            toolCallId: `${id}-call`,
            name: "vault_process",
            input: { path: "notes/a.md", operation: "replace", params: { search: before, replace: after } },
            path: "notes/a.md",
            expectedBefore: before,
            expectedAfter: after,
        }],
    });

    const sdkUndoIntent = (id: string, turnId: string, receiptId: string): OperationsIntent => ({
        id,
        runId: "request-run",
        turnId,
        createdAt: 1,
        expiresAt: 2,
        state: "pending",
        operations: [{
            kind: "resource",
            id: `${id}-operation`,
            toolCallId: `${id}-call`,
            name: "obsidian.operations.undo",
            input: { action: "undo", receiptId },
            path: "notes/a.md",
            expectedBefore: "B",
            expectedAfter: "A",
            resource: { action: "undo", receiptId },
        } as never],
    });

    function makeRequestFixture() {
        const undoRequests: Array<Record<string, unknown>> = [];
        const listeners = new Set<(event: OperationsControllerEvent) => void>();
        let current = true;
        const session = new OperationsReviewSession({
            scope: "request",
            runId: "request-run",
            controller: {
                undoRequest: async input => {
                    undoRequests.push({ ...input, signal: input.signal });
                    return input.intentIds.map((intentId, index) => ({
                        receiptId: `receipt-${intentId}`,
                        operationId: `${intentId}-operation`,
                        status: "undone" as const,
                        path: "notes/a.md",
                        ...(index === 0 ? undefined : {}),
                    }));
                },
                subscribe: listener => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
            },
            sessionIdentity: "view-1",
            isSourceCurrent: () => current,
        });
        const emit = (event: OperationsControllerEvent) => {
            for (const listener of [...listeners]) listener(event);
        };
        return { session, undoRequests, emit, invalidateSource: () => { current = false; } };
    }

    it("aggregates one user run and folds continuous results into a single net difference", () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("intent-1", "turn-1", "A", "B"));
        fixture.emit({ type: "intent-state-changed", intent: {
            ...requestIntent("intent-1", "turn-1", "A", "B"), state: "executing" } });
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-1",
                state: "completed",
                operations: [{
                    operationId: "intent-1-operation",
                    toolCallId: "intent-1-call",
                    name: "vault_process",
                    path: "notes/a.md",
                    status: "succeeded",
                    receiptId: "receipt-intent-1",
                }],
            },
        });
        fixture.session.addIntent(requestIntent("intent-2", "turn-2", "B", "C"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-2",
                state: "completed",
                operations: [{
                    operationId: "intent-2-operation",
                    toolCallId: "intent-2-call",
                    name: "vault_process",
                    path: "notes/a.md",
                    status: "succeeded",
                    receiptId: "receipt-intent-2",
                }],
            },
        });
        fixture.session.addIntent(requestIntent("intent-2", "turn-2", "B", "C"));

        const snapshot = fixture.session.getSnapshot();
        expect(snapshot.scope).toBe("request");
        expect(snapshot.runId).toBe("request-run");
        expect(snapshot.model?.groups).toHaveLength(1);
        expect(snapshot.model?.groups[0]).toMatchObject({ before: "A", after: "C" });
        expect(snapshot.status).toBe("completed");
        expect(snapshot.intentId).toBe("request-run");
    });

    it("keeps stopped-run facts and exposes one whole-request Undo entry", async () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("intent-1", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-1",
                state: "partial",
                operations: [{
                    operationId: "intent-1-operation",
                    toolCallId: "intent-1-call",
                    name: "vault_process",
                    path: "notes/a.md",
                    status: "succeeded",
                    receiptId: "receipt-intent-1",
                }],
            },
        });
        fixture.session.finishRun("stopped");
        expect(fixture.session.getSnapshot()).toMatchObject({ status: "partial", terminalCause: "stopped" });
        expect(fixture.session.canUndo()).toBe(true);

        await fixture.session.undoRequest();
        expect(fixture.undoRequests).toHaveLength(1);
        expect(fixture.undoRequests[0]).toMatchObject({ runId: "request-run", intentIds: ["intent-1"] });
        expect(fixture.session.getSnapshot()).toMatchObject({ status: "undone", actionInFlight: null });
    });

    it("does not open Undo before the run settles and aborts the review lifetime on invalidation", async () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("intent-1", "turn-1", "A", "B"));
        expect(fixture.session.getSnapshot().status).toBe("pending");
        expect(fixture.session.canUndo()).toBe(false);

        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-1",
                state: "completed",
                operations: [{
                    operationId: "intent-1-operation",
                    toolCallId: "intent-1-call",
                    name: "vault_process",
                    path: "notes/a.md",
                    status: "succeeded",
                    receiptId: "receipt-intent-1",
                }],
            },
        });
        fixture.session.finishRun("completed");
        const undoing = fixture.session.undoRequest();
        const signal = fixture.undoRequests[0]?.signal as AbortSignal | undefined;
        expect(signal?.aborted).toBe(false);
        fixture.session.invalidate("unavailable");
        expect(signal?.aborted).toBe(true);
        await undoing;
    });

    it("keeps earlier unknown or failed member facts when a later member completes", () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("intent-1", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-1",
                state: "unknown",
                operations: [{
                    operationId: "intent-1-operation", toolCallId: "intent-1-call",
                    name: "vault_process", path: "notes/a.md", status: "unknown",
                }],
            },
        });
        fixture.session.addIntent(requestIntent("intent-2", "turn-2", "B", "C"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-2",
                state: "completed",
                operations: [{
                    operationId: "intent-2-operation", toolCallId: "intent-2-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-intent-2",
                }],
            },
        });
        fixture.session.finishRun("completed");
        const unknownSnapshot = fixture.session.getSnapshot();
        expect(unknownSnapshot.status).toBe("unknown");
        expect(unknownSnapshot.operationResults.map(result => result.status)).toEqual(["unknown", "succeeded"]);
        expect(fixture.session.canUndo()).toBe(false);
    });

    it("keeps a mixed cross-member Undo outcome partial instead of all-undone", async () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("intent-1", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-1",
                state: "completed",
                operations: [{
                    operationId: "intent-1-operation", toolCallId: "intent-1-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-intent-1",
                }],
            },
        });
        fixture.session.addIntent(requestIntent("intent-2", "turn-2", "B", "C"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-2",
                state: "completed",
                operations: [{
                    operationId: "intent-2-operation", toolCallId: "intent-2-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-intent-2",
                }],
            },
        });
        fixture.session.finishRun("completed");
        fixture.emit({ type: "undo-result", result: {
            receiptId: "receipt-intent-2", operationId: "intent-2-operation", status: "undone" } });
        fixture.emit({ type: "undo-result", result: {
            receiptId: "receipt-intent-1", operationId: "intent-1-operation",
            status: "stale", message: "changed" } });
        const snapshot = fixture.session.getSnapshot();
        expect(snapshot.status).toBe("partial");
        expect(snapshot.undoResults.map(result => result.status)).toEqual(["undone", "stale"]);
        expect(fixture.session.activeReceiptIds()).toEqual(["receipt-intent-1"]);
    });

    it("keeps preview members in a separate partition without Undo", () => {
        const fixture = makeRequestFixture();
        const previewIntent: OperationsIntent = {
            ...requestIntent("preview-intent", "turn-p", "A", "Z"),
            mode: "preview",
        };
        fixture.session.addIntent(previewIntent);
        fixture.session.addIntent(requestIntent("apply-intent", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "apply-intent",
                state: "completed",
                operations: [{
                    operationId: "apply-intent-operation", toolCallId: "apply-intent-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-apply",
                }],
            },
        });
        fixture.session.finishRun("completed");
        const snapshot = fixture.session.getSnapshot();
        expect(snapshot.model?.groups).toHaveLength(1);
        expect(snapshot.model?.groups[0]).toMatchObject({ before: "A", after: "B" });
        expect(snapshot.model?.previewGroups).toHaveLength(1);
        expect(snapshot.model?.previewGroups![0]).toMatchObject({ before: "A", after: "Z" });
        expect(fixture.session.canUndo()).toBe(true);
        fixture.session.activeReceiptIds();
    });

    it("marks a pure-preview run as preview after finish", () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent({ ...requestIntent("preview-intent", "turn-p", "A", "Z"), mode: "preview" });
        fixture.session.finishRun("completed");
        expect(fixture.session.getSnapshot()).toMatchObject({ status: "preview" });
        expect(fixture.session.canUndo()).toBe(false);
    });

    it("freezes the original request diff for partial and whole Undo history", async () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("intent-1", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-1",
                state: "completed",
                operations: [{
                    operationId: "intent-1-operation", toolCallId: "intent-1-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-intent-1",
                }],
            },
        });
        fixture.session.finishRun("completed");
        const original = fixture.session.getSnapshot().model;
        expect(original?.groups[0]).toMatchObject({ before: "A", after: "B" });

        fixture.emit({ type: "undo-result", result: {
            receiptId: "receipt-intent-1", operationId: "intent-1-operation", status: "undone" } });
        const undoneSnapshot = fixture.session.getSnapshot();
        expect(undoneSnapshot.status).toBe("undone");
        expect(undoneSnapshot.model?.groups).toHaveLength(0);
        expect(undoneSnapshot.historicalModel?.groups[0]).toMatchObject({ before: "A", after: "B" });
    });

    it("keeps other members' Undo when one member is cancelled or expired", () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("cancelled-intent", "turn-1", "A", "B"));
        fixture.session.addIntent(requestIntent("completed-intent", "turn-2", "B", "C"));
        fixture.emit({ type: "intent-cancelled", intent: {
            ...requestIntent("cancelled-intent", "turn-1", "A", "B"), state: "cancelled" } });
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "completed-intent",
                state: "completed",
                operations: [{
                    operationId: "completed-intent-operation", toolCallId: "completed-intent-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-completed",
                }],
            },
        });
        fixture.session.finishRun("completed");
        expect(fixture.session.getSnapshot()).toMatchObject({ status: "completed" });
        expect(fixture.session.canUndo()).toBe(true);
        fixture.emit({ type: "intent-expired", intentId: "cancelled-intent" });
        expect(fixture.session.getSnapshot()).toMatchObject({ status: "completed" });
        expect(fixture.session.canUndo()).toBe(true);
    });

    it("keeps a request partial when an unrecoverable effect remains after later writes recover", () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("intent-1", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-1",
                state: "completed",
                operations: [
                    {
                        operationId: "mkdir-operation", toolCallId: "mkdir-call",
                        name: "obsidian.vault.mkdir", path: "assets/new", status: "succeeded",
                        undoAvailable: false,
                        resourceEffect: { kind: "mkdir", paths: ["assets/new"] },
                    },
                    {
                        operationId: "text-operation", toolCallId: "text-call",
                        name: "vault_process", path: "notes/a.md", status: "succeeded",
                        receiptId: "receipt-text",
                    },
                ],
            },
        });
        fixture.session.finishRun("completed");
        fixture.emit({ type: "undo-result", result: {
            receiptId: "receipt-text", operationId: "text-operation", status: "undone" } });
        expect(fixture.session.getSnapshot().status).toBe("partial");
        fixture.emit({ type: "undo-result", result: {
            receiptId: "request-undo-barrier:mintent:mkdir", operationId: "mkdir-operation",
            status: "unavailable", failureCategory: "undo_unavailable" } });
        expect(fixture.session.getSnapshot().status).toBe("partial");
    });

    it("reports all-recovered when a zero-effect failure never had a receipt", () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("intent-1", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-1",
                state: "partial",
                operations: [
                    {
                        operationId: "failed-operation", toolCallId: "failed-call",
                        name: "vault_process", path: "notes/a.md", status: "failed",
                    },
                    {
                        operationId: "text-operation", toolCallId: "text-call",
                        name: "vault_process", path: "notes/a.md", status: "succeeded",
                        receiptId: "receipt-text",
                    },
                ],
            },
        });
        fixture.session.finishRun("completed");
        fixture.emit({ type: "undo-result", result: {
            receiptId: "receipt-text", operationId: "text-operation", status: "undone" } });
        expect(fixture.session.getSnapshot().status).toBe("undone");
    });

    it("freezes the final request model at the first user recovery, not at an earlier SDK restore", async () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("sdk-intent", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "sdk-intent",
                state: "completed",
                operations: [{
                    operationId: "sdk-intent-operation", toolCallId: "sdk-intent-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-sdk-intent",
                }],
            },
        });
        // An explicit SDK restore settles its own receipt early.
        fixture.emit({ type: "undo-result", result: {
            receiptId: "receipt-sdk-intent", operationId: "sdk-intent-operation", status: "undone" } });
        // A later real write in the same request leaves C currently effective.
        fixture.session.addIntent(requestIntent("write-intent", "turn-2", "A", "C"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "write-intent",
                state: "completed",
                operations: [{
                    operationId: "write-intent-operation", toolCallId: "write-intent-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-write-intent",
                }],
            },
        });
        fixture.session.finishRun("completed");
        const beforeUserUndo = fixture.session.getSnapshot();
        expect(beforeUserUndo.model?.groups[0]).toMatchObject({ before: "A", after: "C" });
        // C is still effective, so the early SDK restore must not turn the
        // request card into a historical A→B view.
        expect(beforeUserUndo.historicalModel).toBeNull();

        const originalModel = beforeUserUndo.model;
        await fixture.session.undoRequest();
        const afterUserUndo = fixture.session.getSnapshot();
        expect(afterUserUndo.status).toBe("undone");
        expect(afterUserUndo.historicalModel?.groups[0]).toMatchObject({ before: "A", after: "C" });
        // A retry must reuse the original final history, never re-freeze a
        // trimmed current model.
        await fixture.session.undoRequest();
        expect(fixture.session.getSnapshot().historicalModel).toBe(originalModel);
    });

    it("keeps an all-restored request undone through the full SDK Undo member lifecycle", async () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("write-intent", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "write-intent",
                state: "completed",
                operations: [{
                    operationId: "write-intent-operation", toolCallId: "write-intent-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-write-intent",
                }],
            },
        });
        // The SDK Undo is its own admitted resource intent in the same run.
        const undoMember = sdkUndoIntent("sdk-undo-intent", "turn-2", "receipt-write-intent");
        fixture.session.addIntent(undoMember);
        fixture.emit({ type: "intent-state-changed", intent: { ...undoMember, state: "executing" } });
        fixture.emit({ type: "undo-result", result: {
            receiptId: "receipt-write-intent", operationId: "write-intent-operation", status: "undone" } });
        // The undo member itself is still executing; all-restored waits for
        // its owner terminal fact.
        expect(fixture.session.getSnapshot().status).not.toBe("undone");
        fixture.emit({
            type: "operation-result",
            intentId: "sdk-undo-intent",
            result: {
                operationId: "sdk-undo-intent-operation", toolCallId: "sdk-undo-intent-call",
                name: "obsidian.operations.undo", path: "notes/a.md", status: "succeeded",
                resourceEffect: { kind: "undo", undoStatus: "undone" }, undoAvailable: false,
            },
        });
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "sdk-undo-intent",
                state: "completed",
                operations: [{
                    operationId: "sdk-undo-intent-operation", toolCallId: "sdk-undo-intent-call",
                    name: "obsidian.operations.undo", path: "notes/a.md", status: "succeeded",
                    resourceEffect: { kind: "undo", undoStatus: "undone" }, undoAvailable: false,
                }],
            },
        });
        const settled = fixture.session.getSnapshot();
        expect(settled.status).toBe("undone");
        expect(settled.historicalModel?.groups[0]).toMatchObject({ before: "A", after: "B" });
        // The SDK undo fact itself stays visible as an operation fact.
        expect(settled.operationResults.some(result => result.name === "obsidian.operations.undo"
            && result.resourceEffect?.kind === "undo")).toBe(true);

        // A later real write still shows as the current effective change.
        fixture.session.addIntent(requestIntent("later-intent", "turn-3", "A", "C"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "later-intent",
                state: "completed",
                operations: [{
                    operationId: "later-intent-operation", toolCallId: "later-intent-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-later-intent",
                }],
            },
        });
        const current = fixture.session.getSnapshot();
        expect(current.status).toBe("completed");
        expect(current.model?.groups[0]).toMatchObject({ before: "A", after: "C" });
        expect(current.historicalModel).toBeNull();

        // First user whole-request recovery freezes the current final model.
        fixture.session.finishRun("completed");
        await fixture.session.undoRequest();
        expect(fixture.session.getSnapshot().historicalModel?.groups[0])
            .toMatchObject({ before: "A", after: "C" });
    });

    it("does not report undone while a queued same-run member is still outstanding", () => {
        const fixture = makeRequestFixture();
        fixture.session.addIntent(requestIntent("write-intent", "turn-1", "A", "B"));
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "write-intent",
                state: "completed",
                operations: [{
                    operationId: "write-intent-operation", toolCallId: "write-intent-call",
                    name: "vault_process", path: "notes/a.md", status: "succeeded",
                    receiptId: "receipt-write-intent",
                }],
            },
        });
        const undoMember = sdkUndoIntent("sdk-undo-intent", "turn-2", "receipt-write-intent");
        fixture.session.addIntent(undoMember);
        fixture.emit({ type: "intent-state-changed", intent: { ...undoMember, state: "executing" } });
        // A later same-run intent is admitted and executing before its first
        // effect settles; the owner queue may interleave these facts.
        const queued: OperationsIntent = {
            id: "queued-intent",
            runId: "request-run",
            turnId: "turn-3",
            createdAt: 1,
            expiresAt: 2,
            state: "pending",
            operations: [
                {
                    id: "queued-intent-operation",
                    toolCallId: "queued-intent-call",
                    name: "vault_process",
                    input: { path: "notes/b.md", operation: "replace", params: { search: "B0", replace: "B1" } },
                    path: "notes/b.md",
                    expectedBefore: "B0",
                    expectedAfter: "B1",
                },
                {
                    id: "queued-intent-second-operation",
                    toolCallId: "queued-intent-second-call",
                    name: "vault_process",
                    input: { path: "notes/c.md", operation: "replace", params: { search: "C0", replace: "C1" } },
                    path: "notes/c.md",
                    expectedBefore: "C0",
                    expectedAfter: "C1",
                },
            ],
        };
        fixture.session.addIntent(queued);
        fixture.emit({ type: "intent-state-changed", intent: { ...queued, state: "executing" } });
        fixture.emit({ type: "undo-result", result: {
            receiptId: "receipt-write-intent", operationId: "write-intent-operation", status: "undone" } });
        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "sdk-undo-intent",
                state: "completed",
                operations: [{
                    operationId: "sdk-undo-intent-operation", toolCallId: "sdk-undo-intent-call",
                    name: "obsidian.operations.undo", path: "notes/a.md", status: "succeeded",
                    resourceEffect: { kind: "undo", undoStatus: "undone" }, undoAvailable: false,
                }],
            },
        });
        expect(fixture.session.getSnapshot().status).not.toBe("undone");

        // The queued member's first real write lands while its second native
        // await is still outstanding; the known diff shows, status stays open.
        fixture.emit({
            type: "operation-result",
            intentId: "queued-intent",
            result: {
                operationId: "queued-intent-operation", toolCallId: "queued-intent-call",
                name: "vault_process", path: "notes/b.md", status: "succeeded",
                receiptId: "receipt-queued-first",
            },
        });
        const duringNative = fixture.session.getSnapshot();
        expect(duringNative.status).not.toBe("undone");
        expect(fixture.session.canUndo()).toBe(false);
        const duringGroup = duringNative.model?.groups
            .find(group => group.normalizedPath === "notes/b.md");
        expect(duringGroup).toMatchObject({ before: "B0", after: "B1" });

        fixture.session.finishRun("stopped");
        const stopped = fixture.session.getSnapshot();
        expect(stopped.status).toBe("unknown");
        expect(fixture.session.canUndo()).toBe(false);
        expect(stopped.model?.groups
            .find(group => group.normalizedPath === "notes/b.md")).toMatchObject({ before: "B0", after: "B1" });

        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "queued-intent",
                state: "partial",
                operations: [
                    {
                        operationId: "queued-intent-operation", toolCallId: "queued-intent-call",
                        name: "vault_process", path: "notes/b.md", status: "succeeded",
                        receiptId: "receipt-queued-first",
                    },
                    {
                        operationId: "queued-intent-second-operation", toolCallId: "queued-intent-second-call",
                        name: "vault_process", path: "notes/c.md", status: "stale",
                        failureCategory: "stale_target",
                    },
                ],
            },
        });
        const settled = fixture.session.getSnapshot();
        expect(settled.status).toBe("partial");
        expect(settled.model?.groups
            .find(group => group.normalizedPath === "notes/b.md")).toMatchObject({ before: "B0", after: "B1" });
        expect(settled.model?.groups.some(group => group.normalizedPath === "notes/c.md")).toBe(false);
    });

    it("projects each applied operation fact while a later native write is still unresolved", () => {
        const fixture = makeRequestFixture();
        const twoWriteIntent: OperationsIntent = {
            id: "intent-1",
            runId: "request-run",
            turnId: "turn-1",
            createdAt: 1,
            expiresAt: 2,
            state: "pending",
            operations: [
                {
                    id: "intent-1-operation",
                    toolCallId: "intent-1-call",
                    name: "vault_process",
                    input: { path: "notes/a.md", operation: "replace", params: { search: "A", replace: "B" } },
                    path: "notes/a.md",
                    expectedBefore: "A",
                    expectedAfter: "B",
                },
                {
                    id: "intent-1-second-operation",
                    toolCallId: "intent-1-second-call",
                    name: "vault_process",
                    input: { path: "notes/b.md", operation: "replace", params: { search: "B0", replace: "B1" } },
                    path: "notes/b.md",
                    expectedBefore: "B0",
                    expectedAfter: "B1",
                },
            ],
        };
        fixture.session.addIntent(twoWriteIntent);
        fixture.emit({ type: "intent-state-changed", intent: { ...twoWriteIntent, state: "executing" } });
        fixture.emit({
            type: "operation-result",
            intentId: "intent-1",
            result: {
                operationId: "intent-1-operation", toolCallId: "intent-1-call",
                name: "vault_process", path: "notes/a.md", status: "succeeded",
                receiptId: "receipt-1",
            },
        });
        const duringExecution = fixture.session.getSnapshot();
        expect(duringExecution.status).toBe("executing");
        expect(duringExecution.model?.groups).toHaveLength(1);
        expect(duringExecution.model?.groups[0]).toMatchObject({ before: "A", after: "B" });
        expect(fixture.session.canUndo()).toBe(false);

        fixture.session.finishRun("stopped");
        const stopped = fixture.session.getSnapshot();
        expect(stopped.status).toBe("unknown");
        expect(stopped.model?.groups).toHaveLength(1);
        expect(fixture.session.canUndo()).toBe(false);

        fixture.emit({
            type: "intent-result",
            result: {
                intentId: "intent-1",
                state: "partial",
                operations: [
                    {
                        operationId: "intent-1-operation", toolCallId: "intent-1-call",
                        name: "vault_process", path: "notes/a.md", status: "succeeded",
                        receiptId: "receipt-1",
                    },
                    {
                        operationId: "intent-1-second-operation", toolCallId: "intent-1-second-call",
                        name: "vault_process", path: "notes/b.md", status: "stale",
                        failureCategory: "stale_target",
                    },
                ],
            },
        });
        const settled = fixture.session.getSnapshot();
        expect(settled.status).toBe("partial");
        expect(settled.model?.groups).toHaveLength(1);
    });
});
