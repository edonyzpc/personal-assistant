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
            operations: [{
                toolCallId: "call",
                name: "vault_append",
                input: { path: "notes/a.md", content: "\nafter" },
            }],
        });
        const session = new OperationsReviewSession({
            intent,
            controller: {
                confirm: async (intentId) => await controller.executeIntent(intentId),
                cancel: (intentId) => controller.cancelIntent(intentId),
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
    it("requires activation and routes competing confirms through the controller once", async () => {
        const fixture = makeFixture();
        const session = await fixture.makeSession();

        expect(session.canConfirm()).toBe(false);
        await expect(session.confirm()).resolves.toBeNull();
        expect(fixture.vault.files.get("notes/a.md")).toBe("before");

        session.activate();
        expect(session.canConfirm()).toBe(true);
        const first = session.confirm();
        const second = session.confirm();
        expect(await second).toBeNull();
        const result = await first;
        expect(result?.state).toBe("completed");
        expect(fixture.vault.files.get("notes/a.md")).toBe("before\nafter");
        expect(session.getSnapshot()).toMatchObject({
            status: "completed",
            operationResults: [expect.objectContaining({ status: "succeeded" })],
        });
        expect(fixture.snapshots.some(snapshot => snapshot.status === "executing")).toBe(true);
        fixture.controller.dispose();
    });

    it("keeps Undo receipts one-time and shared across UI surfaces", async () => {
        const fixture = makeFixture();
        const chatSession = await fixture.makeSession();
        const fullViewSession = chatSession;
        chatSession.activate();
        await chatSession.confirm();
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

    it("cancel propagates from the shared adapter without writing", async () => {
        const fixture = makeFixture();
        const session = await fixture.makeSession();
        session.activate();
        const cancelled = session.cancel();

        expect(cancelled).toMatchObject({ state: "cancelled" });
        expect(session.getSnapshot().status).toBe("cancelled");
        expect(session.canConfirm()).toBe(false);
        expect(fixture.vault.files.get("notes/a.md")).toBe("before");
        fixture.controller.dispose();
    });

    it("clears frozen bodies and receipts when the source Chat session is invalidated", async () => {
        const fixture = makeFixture();
        const session = await fixture.makeSession();
        session.activate();
        await session.confirm();
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
            operations: [{
                toolCallId: "call",
                name: "vault_append",
                input: { path: "notes/a.md", content: "\nafter" },
            }],
        });
        const session = new OperationsReviewSession({
            intent,
            controller: {
                confirm: async (intentId) => await controller.executeIntent(intentId),
                cancel: (intentId) => controller.cancelIntent(intentId),
                undoMany: async (receiptIds) => await controller.undoMany(receiptIds),
                subscribe: (listener) => controller.subscribe(listener),
            },
            sessionIdentity: "events",
            isSourceCurrent: () => true,
        });
        const seen: string[] = [];
        session.subscribe(snapshot => seen.push(snapshot.status));
        session.activate();
        await session.confirm();

        expect(events.map(event => event.type)).toEqual(expect.arrayContaining([
            "intent-state-changed",
            "operation-result",
            "intent-result",
        ]));
        expect(seen).toEqual(expect.arrayContaining(["executing", "completed"]));
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
            confirm: async (intentId: string) => await controller.executeIntent(intentId),
            cancel: (intentId: string) => controller.cancelIntent(intentId),
            undoMany: async (receiptIds: readonly string[]) => await controller.undoMany(receiptIds),
            subscribe: (listener: (event: OperationsControllerEvent) => void) => controller.subscribe(listener),
        };
        const intent = await controller.stageIntent({
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
        session.activate();
        const execution = await session.confirm();

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
        session.activate();
        await session.confirm();
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

    it("does not restore a discarded batch when a deferred confirmation returns late", async () => {
        const vault = new MemoryVault();
        let releaseProcess!: (value: string) => void;
        (vault as unknown as {
            process: (file: OperationsVaultFile, transform: (current: string) => string) => Promise<string>;
        }).process = async (_file, transform) => {
            const current = vault.files.get("notes/a.md")!;
            const next = await new Promise<string>(resolve => {
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
                confirm: async (intentId) => await controller.executeIntent(intentId),
                cancel: (intentId) => controller.cancelIntent(intentId),
                undoMany: async (receiptIds) => await controller.undoMany(receiptIds),
                subscribe: (listener) => controller.subscribe(listener),
            },
            sessionIdentity: "deferred",
            isSourceCurrent: () => true,
        });
        session.activate();
        const confirming = session.confirm();
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
                confirm: async () => ({
                    intentId: intent.id,
                    state: "completed",
                    operations: [operation],
                }),
                cancel: () => intent,
                undoMany: async () => [],
                subscribe: listener => {
                    emitControllerEvent = listener;
                    return () => undefined;
                },
            },
            sessionIdentity: "ownership",
            isSourceCurrent: () => true,
        });
        session.activate();
        await session.confirm();

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
