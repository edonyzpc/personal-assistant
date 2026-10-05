import { OperationsService, type OperationsSession } from "../src/ai-services/operations/operations-service";
import type {
    NoteImageRemovalAttachmentFile,
    NoteImageRemovalHost,
    NoteImageRemovalSourceFile,
} from "../src/ai-services/operations/note-image-removal";
import { createTaskSourceConstrainedExecutor } from "../src/ai-services/task-source-executor";
import { TaskSourceRun } from "../src/ai-services/task-source-run";
import type { ParsedBufferedToolCall } from "../src/ai-services/pa-agent-types";
import type { Workspace } from "obsidian";
import type { TaskSourceReadGuard } from "../src/ai-services/task-source-read-guard";
import { ChatService } from "../src/ai-services/chat-service";
import { ChatHistoryManager } from "../src/chat/chat-history-manager";
import { MemoryChatHistoryStore } from "../src/chat/chat-history-store";
import {
    applyOperationsExecutionResult,
    type PaAgentActionState,
} from "../src/ai-services/pa-agent-result-facts";
import { completeInputLineage } from "../src/ai-services/input-lineage";
import {
    NoteImageRemovalResourceOwner,
} from "../src/ai-services/operations/note-image-removal-resources";
import type { OperationsVault, OperationsVaultFile } from "../src/ai-services/operations/types";

jest.mock("obsidian");

const NOTE_PATH = "notes/b160-execution.md";
const OTHER_PATH = "notes/b160-shared.md";
const ATTACHMENT_PATH = "assets/b160-execution.png";
const REFERENCE = "![[assets/b160-execution.png]]";
const BEFORE = `> [!featured-image]\n> Caption.\n> ${REFERENCE}\n> Keep this.\n`;
const AFTER = "> [!featured-image]\n> Caption.\n> Keep this.\n";
const BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const activeServices: OperationsService[] = [];

class ExecutionVault implements OperationsVault {
    readonly notes = new Map([[NOTE_PATH, BEFORE], [OTHER_PATH, "Other note."]]);
    readonly folders = new Set(["notes", "assets"]);
    private currentAttachment: (OperationsVaultFile & { bytes: Uint8Array }) | undefined = {
        path: ATTACHMENT_PATH,
        extension: "png",
        bytes: BYTES.slice(),
    };
    get attachment(): OperationsVaultFile & { bytes: Uint8Array } {
        if (!this.currentAttachment) throw new Error('attachment missing');
        return this.currentAttachment;
    }
    readonly process = jest.fn(async (file: OperationsVaultFile, change: (current: string) => string) => {
        const current = this.notes.get(file.path);
        if (current === undefined) throw new Error("missing");
        this.notes.set(file.path, change(current));
        return { path: file.path, extension: "md" };
    });

    readonly adapter = { exists: jest.fn(async () => true) };
    readonly cachedRead = jest.fn(async (file: OperationsVaultFile) => this.notes.get(file.path) ?? "");
    readonly read = jest.fn(async (file: OperationsVaultFile) => {
        const note = this.notes.get(file.path);
        if (note === undefined) throw new Error('missing');
        return note;
    });
    readonly create = jest.fn(async () => { throw new Error("unused"); });

    readonly trashFile = jest.fn(async (file: OperationsVaultFile) => {
        if (this.trashMode === "throw") throw new Error("trash rejected");
        if (this.trashMode === "remain") return;
        if (file.path !== ATTACHMENT_PATH) throw new Error("unexpected attachment");
        this.currentAttachment = undefined;
    });

    trashMode: "normal" | "throw" | "remain" = "normal";
    get attached(): boolean { return this.currentAttachment !== undefined; }

    restoreAttachment(bytes: Uint8Array): void {
        this.currentAttachment = { path: ATTACHMENT_PATH, extension: 'png', bytes: bytes.slice() };
    }

    setAttachment(bytes: Uint8Array): void {
        this.currentAttachment = { path: ATTACHMENT_PATH, extension: 'png', bytes };
    }

    completeTrash(): void {
        this.currentAttachment = undefined;
    }

    getAbstractFileByPath(path: string): OperationsVaultFile | null {
        if (this.notes.has(path)) return { path, extension: "md" };
        if (path === ATTACHMENT_PATH && this.currentAttachment) return this.currentAttachment;
        if (this.folders.has(path)) return { path, children: [] };
        return null;
    }
}

async function fixture(options: {
    other?: string;
    noteImageRemovalResources?: NoteImageRemovalResourceOwner;
} = {}) {
    const vault = new ExecutionVault();
    if (options.other !== undefined) vault.notes.set(OTHER_PATH, options.other);
    const noteFile = { path: NOTE_PATH };
    const otherFile = { path: OTHER_PATH };
    const attachmentFile = { path: ATTACHMENT_PATH };
    const source = (path: string, extension: "md" | "canvas", file: object, size: number): NoteImageRemovalSourceFile => ({
        path,
        extension,
        file,
        version: { mtime: 10, size },
    });
    const noteIdentity = source(NOTE_PATH, "md", noteFile, BEFORE.length);
    const otherIdentity = source(OTHER_PATH, "md", otherFile, (options.other ?? "Other note.").length);
    const attachmentIdentity = {
        path: ATTACHMENT_PATH,
        extension: "png",
        file: attachmentFile,
        version: { mtime: 10, size: BYTES.byteLength },
    };
    const readSourceFile = jest.fn(async (file: NoteImageRemovalSourceFile) => vault.notes.get(file.path) ?? "");
    const readAttachmentFile = jest.fn(async (file: NoteImageRemovalAttachmentFile) => {
        if (file.path !== ATTACHMENT_PATH || !vault.attached) throw new Error('attachment missing');
        return vault.attachment.bytes.slice().buffer;
    });
    const restoreAttachmentFile = jest.fn(async (
        file: NoteImageRemovalAttachmentFile,
        bytes: ArrayBuffer,
    ): Promise<NoteImageRemovalAttachmentFile | null | undefined> => {
        if (file.path !== ATTACHMENT_PATH || bytes.byteLength !== BYTES.byteLength) {
            throw new Error('invalid restore request');
        }
        vault.restoreAttachment(new Uint8Array(bytes));
        return vault.attached ? attachmentIdentity : undefined;
    });
    const host: NoteImageRemovalHost = {
        getSourceFile: path => path === NOTE_PATH ? noteIdentity : path === OTHER_PATH ? otherIdentity : undefined,
        listSourceFiles: () => [noteIdentity, otherIdentity],
        readSourceFile,
        parseLinktext: linktext => ({ path: linktext, subpath: "" }),
        resolveImageDestination: linkpath => linkpath === ATTACHMENT_PATH && vault.attached
            ? attachmentIdentity
            : undefined,
        isPathAllowed: () => true,
        isAttachmentPathAllowed: () => true,
        readAttachmentFile,
        getAttachmentFileByPath: () => vault.attached ? attachmentIdentity : undefined,
        restoreAttachmentFile,
    };
    let id = 0;
    const service = new OperationsService({
        vault,
        trashFile: async file => await vault.trashFile(file),
        isOperationsAgentEnabled: () => true,
        noteImageRemovalHost: host,
        ...(options.noteImageRemovalResources
            ? { noteImageRemovalResources: options.noteImageRemovalResources }
            : {}),
        createId: () => `execution-${++id}`,
    });
    let current = true;
    let sourceEpoch = "observation-1";
    let authorityEpoch = "authority-1";
    let ancestorAllowed = true;
    const sourceFiles = new Map([[NOTE_PATH, noteFile], [OTHER_PATH, otherFile]]);
    const sourceRun = new TaskSourceRun({
        runId: "run-execution",
        userMessageId: "user-execution",
        userText: "Remove this image.",
        workspace: {
            getActiveViewOfType: () => ({ file: noteFile }),
            getMostRecentLeaf: () => null,
            getLeavesOfType: () => [],
        } as unknown as Workspace,
        getFileByPath: path => sourceFiles.get(path),
        isCurrent: () => current,
        getMemoryEvidenceEpoch: () => sourceEpoch,
        getTaskSourceAuthorityEpoch: () => authorityEpoch,
        isPathAllowed: () => ancestorAllowed,
    });
    const removeCall: ParsedBufferedToolCall = {
        type: "toolCall",
        id: "call-remove",
        index: 0,
        name: "remove_note_image",
        input: { notePath: NOTE_PATH, imageReference: REFERENCE, attachmentAction: "delete" },
    };
    const sourceExecutor = createTaskSourceConstrainedExecutor({
        baseExecutor: { execute: jest.fn(async () => ({ outcome: "success" as const, promptText: "unused" })) },
        state: sourceRun.state,
        resolveHostNoteId: sourceRun.resolveNoteId,
        isHostCurrent: sourceRun.isCurrent,
        resolveReadPlans: sourceRun.resolveReadPlans,
        resolveNoteSearchScope: sourceRun.resolveNoteSearchScope,
        prepareInputSourceAdmission: async () => {
            const admitted = await sourceRun.prepareLineageAdmission(completeInputLineage([
            { kind: "user-text", messageId: "user-execution" },
            { kind: "vault", path: NOTE_PATH, via: "note" },
            { kind: "run-notes-observation", runId: "run-execution", owner: "vault", sourceEpoch },
            ]));
            return admitted;
        },
    });
    const admission = sourceExecutor.preflightBatch!({
        runId: "run-execution",
        turnId: "turn-execution",
        turnIndex: 0,
        userInput: "Remove this image.",
        toolCalls: [removeCall],
    });
    if (!admission || !("kind" in admission) || admission.kind !== "admitted" || !admission.taskSourceReadGuard) {
        throw new Error("Expected real TaskSourceRun admission");
    }
    const guard: TaskSourceReadGuard = admission.taskSourceReadGuard;
    await guard.checkpoint?.();
    const session = service.createSession({ surface: "test" });
    activeServices.push(service);
    const stage = (
        attachmentAction: "keep" | "delete",
        target: OperationsSession = session,
    ) => target.stage({
        runId: "run-execution",
        turnId: "turn-execution",
        taskSourceReadGuard: guard,
        operations: [{
            toolCallId: "call-remove",
            name: "remove_note_image",
            input: { notePath: NOTE_PATH, imageReference: REFERENCE, attachmentAction },
        }],
    });
    return {
        vault,
        host,
        readSourceFile,
        readAttachmentFile,
        restoreAttachmentFile,
        setAttachment: (bytes: Uint8Array) => vault.setAttachment(bytes),
        service,
        session,
        stage,
        guard,
        advanceObservationEpoch: () => { sourceEpoch = "observation-2"; },
        advanceAuthorityEpoch: () => { authorityEpoch = "authority-2"; },
        revokeAncestor: () => { ancestorAllowed = false; },
    };
}

afterEach(() => {
    for (const service of activeServices.splice(0)) service.dispose();
    jest.useRealTimers();
});

function pendingAction(intentId: string): PaAgentActionState {
    return {
        schemaVersion: 1,
        owner: "operations",
        operationId: intentId,
        phase: "pending",
        revision: 0,
        origin: {
            runId: "run-execution",
            turnId: "turn-execution",
            assistantId: "assistant",
            callId: "call-remove",
            resultId: "result-remove",
        },
        inputLineage: completeInputLineage([{ kind: "user-text", messageId: "user-execution" }]),
        receipt: { kind: "operations-staged", intentId },
    };
}

describe("B-160 note image removal execution", () => {
    it("confirms a delete as two effects and restores the original bytes and note with Undo", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const originalProcess = h.vault.process.getMockImplementation();
        h.vault.process.mockImplementation(async (file, change) => {
            const implementation = originalProcess;
            if (!implementation) throw new Error("missing process implementation");
            const written = await implementation(file, change);
            h.advanceObservationEpoch();
            return written;
        });
        expect(h.vault.process).not.toHaveBeenCalled();
        expect(h.readAttachmentFile).not.toHaveBeenCalled();

        const result = await h.session.confirm(intent.id);
        expect(result.state).toBe("completed");
        expect(result.operations[0]).toMatchObject({
            status: "succeeded",
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "removed" },
            ],
            undoAvailable: true,
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(false);
        expect(h.readAttachmentFile.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(h.vault.trashFile).toHaveBeenCalledTimes(1);

        const undo = await h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        expect(undo).toHaveLength(1);
        expect(undo[0]).toMatchObject({ status: "undone" });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.attached).toBe(true);
        expect(h.vault.attachment.bytes).toEqual(BYTES);
        expect(h.restoreAttachmentFile).toHaveBeenCalledTimes(1);
        const context = h.session.getContextResult(intent.id, "run-execution");
        expect(context.undoResults[0]).toMatchObject({
            effects: [
                { key: "note", status: "restored" },
                { key: "attachment", status: "restored" },
            ],
            undoAvailable: false,
        });
        h.service.dispose();
    });

    it("keeps current Agent authority across its own note observation change before Trash", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const originalProcess = h.vault.process.getMockImplementation();
        if (!originalProcess) throw new Error("missing process implementation");
        h.vault.process.mockImplementation(async (file, change) => {
            const written = await originalProcess(file, change);
            h.advanceObservationEpoch();
            h.advanceAuthorityEpoch();
            return written;
        });
        const result = await h.session.executeCurrentIntent({
            intentId: intent.id, runId: "run-execution", taskSourceReadGuard: h.guard,
        });
        expect(result.state).toBe("completed");
        expect(result.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: true,
            effects: [{ key: "note", status: "applied" }, { key: "attachment", status: "removed" }] });
        expect(h.vault.trashFile).toHaveBeenCalledTimes(1);
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(false);
    });

    it("continues an ordinary Agent batch across its own authority epoch change", async () => {
        const h = await fixture({ other: "Other" });
        const intent = await h.session.stage({ runId: "run-execution", turnId: "turn-execution",
            taskSourceReadGuard: h.guard, operations: [
                { toolCallId: "append-note", name: "vault_append", input: { path: NOTE_PATH, content: "First" } },
                { toolCallId: "append-other", name: "vault_append", input: { path: OTHER_PATH, content: "Second" } },
            ] });
        const originalProcess = h.vault.process.getMockImplementation();
        if (!originalProcess) throw new Error("missing process implementation");
        h.vault.process.mockImplementation(async (file, change) => {
            const written = await originalProcess(file, change);
            h.advanceObservationEpoch();
            h.advanceAuthorityEpoch();
            return written;
        });
        const result = await h.session.executeCurrentIntent({
            intentId: intent.id, runId: "run-execution", taskSourceReadGuard: h.guard,
        });
        expect(result).toMatchObject({ state: "completed", operations: [
            { status: "succeeded" }, { status: "succeeded" },
        ] });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(`${BEFORE}First`);
        expect(h.vault.notes.get(OTHER_PATH)).toBe("Other\nSecond");
        expect(h.vault.process).toHaveBeenCalledTimes(2);
    });

    it.each(["cancel", "source revoke"])("stops Trash after %s during the Agent's native note write", async kind => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const abort = new AbortController();
        const originalProcess = h.vault.process.getMockImplementation();
        if (!originalProcess) throw new Error("missing process implementation");
        h.vault.process.mockImplementationOnce(async (file, change) => {
            const written = await originalProcess(file, change);
            h.advanceObservationEpoch();
            h.advanceAuthorityEpoch();
            if (kind === "cancel") abort.abort();
            else h.revokeAncestor();
            return written;
        });
        const result = await h.session.executeCurrentIntent({
            intentId: intent.id, runId: "run-execution", taskSourceReadGuard: h.guard, signal: abort.signal,
        });
        expect(result.state).toBe("partial");
        expect(result.operations[0].effects?.[0]).toMatchObject({ key: "note", status: "applied" });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(true);
        expect(h.vault.trashFile).not.toHaveBeenCalled();
    });

    it("retains and restores a recovery snapshot larger than the retired shared budget", async () => {
        const h = await fixture();
        const original = h.host.resolveImageDestination(ATTACHMENT_PATH, NOTE_PATH);
        if (!original) throw new Error("missing staged attachment identity");
        const byteLength = 64 * 1024 * 1024 + 1;
        const bytes = new Uint8Array(byteLength);
        bytes.fill(1);
        h.setAttachment(bytes);
        const largeIdentity = { ...original, version: { mtime: original.version.mtime, size: byteLength } };
        const currentAttachment = (path: string) => path === ATTACHMENT_PATH && h.vault.attached ? largeIdentity : undefined;
        h.host.resolveImageDestination = currentAttachment;
        h.host.getAttachmentFileByPath = currentAttachment;
        h.readAttachmentFile.mockImplementation(async () => h.vault.attachment.bytes.buffer);
        h.restoreAttachmentFile.mockImplementation(async (file, restored) => {
            h.setAttachment(new Uint8Array(restored));
            return h.host.getAttachmentFileByPath?.(file.path);
        });
        const intent = await h.stage("delete");

        const result = await h.session.confirm(intent.id);
        expect(result.state).toBe("completed");
        expect(result.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: true,
            effects: [{ key: "note", status: "applied" }, { key: "attachment", status: "removed" }] });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(false);
        const undone = await h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        expect(undone).toEqual([expect.objectContaining({ status: "undone",
            effects: [{ key: "note", status: "restored" }, { key: "attachment", status: "restored" }] })]);
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.attached).toBe(true);
        expect(h.vault.attachment.bytes.byteLength).toBe(byteLength);
        expect(Buffer.from(h.vault.attachment.bytes).equals(Buffer.from(bytes))).toBe(true);
        expect(h.restoreAttachmentFile).toHaveBeenCalledTimes(1);
        h.service.dispose();
    });

    it("keeps the attachment and uses only the note path", async () => {
        const h = await fixture({ other: `[Other](assets/b160-execution.png#section)` });
        const intent = await h.stage("keep");
        const result = await h.session.confirm(intent.id);
        expect(result.state).toBe("completed");
        expect(result.operations[0]?.effects).toEqual([{ key: "note", status: "applied" }]);
        expect(h.readAttachmentFile).not.toHaveBeenCalled();
        expect(h.vault.trashFile).not.toHaveBeenCalled();
        expect(h.vault.attached).toBe(true);
        const undo = await h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        expect(undo[0]).toMatchObject({
            status: "undone",
            effects: [
                { key: "note", status: "restored" },
            ],
            undoAvailable: false,
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.attached).toBe(true);
        h.service.dispose();
    });

    it("blocks a shared reference before either effect is written", async () => {
        const h = await fixture({ other: `![Other](assets/b160-execution.png)` });
        const intent = await h.stage("delete");
        expect(intent.operations[0]).toMatchObject({ block: { reason: "shared_reference" } });
        expect(h.session.getContextResult(intent.id, intent.runId)).toMatchObject({
            pending: true, executing: false, blockedReason: "shared_reference",
        });
        const historyService = new ChatService({ app: { vault: h.vault }, settings: {}, log: jest.fn() } as unknown as
            ConstructorParameters<typeof ChatService>[0], h.session);
        const status = historyService.getVisibleOperationsStatus(intent.id, intent.runId);
        expect(status).toEqual({ intentId: intent.id, available: true, state: "blocked",
            undoAvailable: false, blockedReason: "shared_reference" });
        expect(JSON.stringify(status)).not.toContain(OTHER_PATH);
        await expect(h.session.confirm(intent.id)).rejects.toThrow("blocked by a shared image reference");
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.process).not.toHaveBeenCalled();
        expect(h.readAttachmentFile).not.toHaveBeenCalled();
        historyService.dispose();
        h.service.dispose();
    });

    it("keeps a shared-reference proposal blocked for the entire batch after the conflict disappears", async () => {
        const h = await fixture({ other: `![Other](assets/b160-execution.png)` });
        const intent = await h.session.stage({
            runId: "run-execution", turnId: "turn-execution", taskSourceReadGuard: h.guard,
            operations: [
                { toolCallId: "append-first", name: "vault_append", input: { path: OTHER_PATH, content: "Never write this." } },
                { toolCallId: "remove-second", name: "remove_note_image",
                    input: { notePath: NOTE_PATH, imageReference: REFERENCE, attachmentAction: "delete" } },
            ],
        });
        h.vault.notes.set(OTHER_PATH, "The external reference was removed.");
        await expect(h.session.confirm(intent.id)).rejects.toThrow("blocked by a shared image reference");
        expect(h.session.getOwnedContextResult(intent.id, intent.runId)).toMatchObject({
            pending: true, executing: false, blockedReason: "shared_reference",
        });
        expect(h.vault.notes.get(OTHER_PATH)).toBe("The external reference was removed.");
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.process).not.toHaveBeenCalled();
        expect(h.readAttachmentFile).not.toHaveBeenCalled();
        expect(h.vault.trashFile).not.toHaveBeenCalled();
    });

    it("stops before any write when a late shared reference appears before confirmation", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        h.vault.notes.set(OTHER_PATH, `![Late](assets/b160-execution.png)`);
        const result = await h.session.confirm(intent.id);
        expect(result.state).toBe("failed");
        expect(result.operations[0]?.effects?.[0]).toMatchObject({
            key: "note",
            status: "failed",
            failureCategory: "boundary_denied",
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.process).not.toHaveBeenCalled();
        expect(h.vault.trashFile).not.toHaveBeenCalled();
        h.service.dispose();
    });

    it("stops before any write when the real TaskSourceRun ancestor permission is revoked", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        h.revokeAncestor();
        const result = await h.session.confirm(intent.id);
        expect(result.state).toBe("failed");
        expect(result.operations[0]?.effects?.[0]).toMatchObject({
            key: "note",
            status: "failed",
            failureCategory: "boundary_denied",
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.process).not.toHaveBeenCalled();
        expect(h.readAttachmentFile).not.toHaveBeenCalled();
        expect(h.vault.trashFile).not.toHaveBeenCalled();
        h.service.dispose();
    });

    it("stops before any write when the recovery snapshot allocation actually fails", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        h.readAttachmentFile.mockImplementationOnce(async () => {
            throw new RangeError("temporary recovery snapshot allocation failed");
        });
        const result = await h.session.confirm(intent.id);

        expect(result.state).toBe("failed");
        expect(result.operations[0]?.effects?.[0]).toMatchObject({
            key: "note",
            status: "failed",
            failureCategory: "fs_error",
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.process).not.toHaveBeenCalled();
        expect(h.readAttachmentFile).toHaveBeenCalledTimes(1);
        h.service.dispose();
    });

    it("keeps owner-scoped Undo snapshots isolated between sessions on one shared resource owner", async () => {
        const h = await fixture();
        const otherSession = h.service.createSession({ surface: "other-test" });
        const first = await h.stage("delete");
        const second = await h.stage("delete", otherSession);

        const firstResult = await h.session.confirm(first.id);
        expect(firstResult.state).toBe("completed");
        const secondResult = await otherSession.confirm(second.id);
        expect(secondResult.state).toBe("failed");
        expect(secondResult.operations[0]?.receiptId).toBeUndefined();

        otherSession.dispose();
        const undo = await h.session.undoMany(firstResult.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        expect(undo[0]).toMatchObject({ status: "undone" });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.attached).toBe(true);
    });

    it("preserves the applied note and unknown attachment fact when Trash fails", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        h.vault.trashMode = "throw";
        const result = await h.session.confirm(intent.id);
        expect(result.state).toBe("partial");
        expect(result.operations[0]).toMatchObject({
            status: "unknown",
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "unknown" },
            ],
            undoAvailable: true,
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.trashFile).toHaveBeenCalledTimes(1);
        expect(h.session.getContextResult(intent.id, "run-execution").execution?.operations[0]).toMatchObject({
            undoAvailable: true,
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "unknown" },
            ],
        });
        h.service.dispose();
    });

    it("keeps an attachment-restored checkpoint and retries without recreating the file", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const result = await h.session.confirm(intent.id);
        const originalRestore = h.restoreAttachmentFile.getMockImplementation();
        if (!originalRestore) throw new Error("missing restore implementation");
        h.restoreAttachmentFile.mockImplementation(async (file, bytes) => {
            h.vault.notes.set(NOTE_PATH, `${AFTER}User edit`);
            return await originalRestore(file, bytes);
        });

        const first = await h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        expect(first[0]).toMatchObject({
            status: "stale",
            checkpoint: "attachment-restored",
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "restored" },
            ],
            undoAvailable: true,
        });
        expect(h.vault.attached).toBe(true);
        expect(h.vault.notes.get(NOTE_PATH)).toBe(`${AFTER}User edit`);
        expect(h.restoreAttachmentFile).toHaveBeenCalledTimes(1);
        expect(h.session.getContextResult(intent.id, "run-execution").undoResults[0]).toMatchObject({
            checkpoint: "attachment-restored",
            undoAvailable: true,
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "restored" },
            ],
        });

        const staleRetry = await h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        expect(staleRetry[0]).toMatchObject({ status: "stale", checkpoint: "attachment-restored",
            effects: [{ key: "note", status: "applied" }, { key: "attachment", status: "restored" }] });
        expect(h.restoreAttachmentFile).toHaveBeenCalledTimes(1);

        h.vault.notes.set(NOTE_PATH, AFTER);
        const second = await h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        expect(second[0]).toMatchObject({ status: "undone" });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.attachment.bytes).toEqual(BYTES);
        expect(h.restoreAttachmentFile).toHaveBeenCalledTimes(1);
        const finalContext = h.session.getContextResult(intent.id, "run-execution");
        expect(finalContext.undoResults).toHaveLength(1);
        expect(finalContext.undoResults[0]).toMatchObject({ status: "undone", undoAvailable: false,
            effects: [{ key: "note", status: "restored" }, { key: "attachment", status: "restored" }] });
        expect(finalContext.undoResults[0].checkpoint).toBeUndefined();
        h.service.dispose();
    });

    it("does not overwrite a different file that collides with the original attachment path", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const result = await h.session.confirm(intent.id);
        h.vault.restoreAttachment(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]));

        const undo = await h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        expect(undo[0]).toMatchObject({ status: "stale", failureCategory: "target_collision" });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attachment.bytes).toEqual(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]));
        expect(h.restoreAttachmentFile).not.toHaveBeenCalled();
        h.service.dispose();
    });

    it("keeps a newer unknown note restoration fact instead of replaying an older recovery checkpoint", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const executed = await h.session.confirm(intent.id);
        const restore = h.restoreAttachmentFile.getMockImplementation();
        if (!restore) throw new Error("missing restore implementation");
        h.restoreAttachmentFile.mockImplementation(async (file, bytes) => {
            const restored = await restore(file, bytes);
            h.vault.notes.set(NOTE_PATH, `${AFTER}User edit`);
            return restored;
        });
        const receipt = executed.operations[0].receiptId!;
        expect((await h.session.undoMany([receipt]))[0]).toMatchObject({ status: "stale", checkpoint: "attachment-restored" });
        h.vault.notes.set(NOTE_PATH, AFTER);
        const process = h.vault.process.getMockImplementation();
        if (!process) throw new Error("missing process implementation");
        h.vault.process.mockImplementation(async (file, change) => {
            await process(file, change);
            throw new Error("native note restoration result unavailable");
        });
        const retried = await h.session.undoMany([receipt]);
        expect(retried[0]).toMatchObject({ status: "unknown", checkpoint: "attachment-restored",
            effects: [{ key: "note", status: "unknown" }, { key: "attachment", status: "restored" }] });
        expect(h.session.getContextResult(intent.id, "run-execution").undoResults).toEqual(retried);
        const historyService = new ChatService({ app: { vault: h.vault }, settings: {}, log: jest.fn() } as unknown as ConstructorParameters<typeof ChatService>[0], h.session);
        const state = historyService.refreshOperationsActionState(pendingAction(intent.id));
        expect(state).toMatchObject({ phase: "partial" });
        expect(state.actions?.map(action => action.effect?.status)).toEqual(["unknown", "restored"]);
        expect(historyService.refreshOperationsActionState(state)).toEqual(state);
        expect(historyService.getVisibleOperationsStatus(intent.id, "run-execution")).toMatchObject({ state: "partial",
            effects: [{ key: "note", status: "unknown" }, { key: "attachment", status: "restored" }] });
        expect(h.restoreAttachmentFile).toHaveBeenCalledTimes(1);
        historyService.dispose();
    });

    it.each(["mismatch", "rejected"] as const)("persists partial recovery with unknown attachment bytes after %s in the original history and query", async mode => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const chatHost = { app: { vault: h.vault }, settings: {}, log: jest.fn() };
        const historyService = new ChatService(chatHost as unknown as ConstructorParameters<typeof ChatService>[0], h.session);
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        try {
            await manager.initialize();
            const pending = pendingAction(intent.id);
            const conversation = await manager.startConversation("Restore the fixture image");
            await store.appendTurn({ conversationId: conversation.id, turnIndex: 0,
                user: { role: "user", content: "Restore the fixture image" },
                assistant: { role: "assistant", content: "Review the proposal", actionStates: [pending],
                    actionStateBinding: { conversationId: conversation.id, turnIndex: 0,
                        runId: pending.origin.runId, turnId: pending.origin.turnId } } });
            historyService.registerOperationsContextPersistence(intent.id, async execution => {
                await manager.updateActionStatesForOperation(conversation.id, pending.origin.runId, "operations", intent.id,
                    states => states.map(state => execution ? applyOperationsExecutionResult(state, execution) ?? state
                        : historyService.refreshOperationsActionState(state)));
            });
            const executed = await historyService.confirmOperationsIntent(intent.id);
            const restore = h.restoreAttachmentFile.getMockImplementation();
            if (!restore) throw new Error("missing restore implementation");
            h.restoreAttachmentFile.mockImplementation(async (file, bytes) => {
                const restored = await restore(file, bytes);
                if (mode === "rejected") throw new Error("native restoration result unavailable");
                h.vault.restoreAttachment(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]));
                return restored;
            });
            const undo = await historyService.undoOperations(executed.operations.flatMap(operation =>
                operation.receiptId ? [operation.receiptId] : []));
            expect(undo[0]).toMatchObject({ status: mode === "mismatch" ? "failed" : "unknown", effects: [
                { key: "note", status: "applied" }, { key: "attachment", status: "unknown" }] });
            expect(historyService.getVisibleOperationsStatus(intent.id, "run-execution")).toMatchObject({
                state: "partial", effects: [
                    { key: "note", status: "applied" }, { key: "attachment", status: "unknown" }] });
            const saved = (await store.getTurns(conversation.id))[0].assistant.actionStates![0];
            expect(saved.phase).toBe("partial");
            expect(saved.actions?.map(action => action.effect?.status)).toEqual(["applied", "unknown"]);
            expect(historyService.refreshOperationsActionState(saved)).toEqual(saved);
            expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        } finally { historyService.dispose(); await store.dispose(); }
    });

    it("rechecks keep source authority after the awaited note read before the first write", async () => {
        const h = await fixture();
        const intent = await h.stage("keep");
        const originalRead = h.readSourceFile.getMockImplementation();
        if (!originalRead) throw new Error("missing source read implementation");
        h.readSourceFile.mockImplementation(async file => {
            const content = await originalRead(file);
            h.revokeAncestor();
            return content;
        });
        const result = await h.session.confirm(intent.id);
        expect(result.state).toBe("failed");
        expect(h.vault.process).not.toHaveBeenCalled();
        expect(h.vault.trashFile).not.toHaveBeenCalled();
        expect(h.readAttachmentFile).not.toHaveBeenCalled();
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
    });

    it("preserves earlier batch effects when image preparation settles after disposal", async () => {
        const h = await fixture();
        const intent = await h.session.stage({ runId: "run-execution", turnId: "turn-execution",
            taskSourceReadGuard: h.guard, operations: [
                { toolCallId: "call-before", name: "vault_append", input: { path: OTHER_PATH, content: "Applied first." } },
                { toolCallId: "call-remove", name: "remove_note_image",
                    input: { notePath: NOTE_PATH, imageReference: REFERENCE, attachmentAction: "delete" } },
                { toolCallId: "call-after", name: "vault_append", input: { path: OTHER_PATH, content: "Must not apply." } },
            ] });
        const originalRead = h.readAttachmentFile.getMockImplementation();
        if (!originalRead) throw new Error("missing attachment read implementation");
        let release!: () => void;
        let notify!: () => void;
        const started = new Promise<void>(resolve => { notify = resolve; });
        h.readAttachmentFile.mockImplementation(async file => {
            notify();
            await new Promise<void>(resolve => { release = resolve; });
            return await originalRead(file);
        });
        const confirmed = h.session.confirm(intent.id);
        await started;
        h.service.dispose();
        release();
        const result = await confirmed;
        expect(result.state).toBe("partial");
        expect(result.operations.map(operation => operation.status)).toEqual(["succeeded", "failed", "skipped"]);
        expect(result.operations.every(operation => operation.undoAvailable === false)).toBe(true);
        expect(result.operations[1].effects).toEqual([{ key: "note", status: "not_started" },
            { key: "attachment", status: "not_started" }]);
        expect(h.vault.notes.get(OTHER_PATH)).toBe("Other note.\nApplied first.");
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.trashFile).not.toHaveBeenCalled();
    });

    it("expires without access but keeps an in-flight lease until it settles", () => {
        jest.useFakeTimers();
        try {
            const now = jest.fn(() => 1_000);
            const owner = new NoteImageRemovalResourceOwner({ now });
            const reservation = owner.reserve(8, () => "reservation");
            const snapshot = owner.retain(reservation, {
                receiptId: "ttl-receipt",
                bytes: new ArrayBuffer(8),
                contentHash: "hash",
                attachment: {
                    path: ATTACHMENT_PATH,
                    extension: "png",
                    file: { path: ATTACHMENT_PATH },
                    version: { mtime: 1, size: 8 },
                },
                expiresAt: 2_000,
            });
            owner.acquire(snapshot.receiptId);
            jest.advanceTimersByTime(1_000);
            expect(owner.has(snapshot.receiptId)).toBe(true);
            owner.releaseLease(snapshot.receiptId);
            expect(owner.has(snapshot.receiptId)).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    it("reports Undo unavailable after the receipt TTL expires without another access", async () => {
        jest.useFakeTimers();
        const h = await fixture();
        try {
            const intent = await h.stage("delete");
            const result = await h.session.confirm(intent.id);
            expect(result.operations[0]?.undoAvailable).toBe(true);
            jest.advanceTimersByTime(30 * 60 * 1_000 + 1);
            const context = h.session.getContextResult(intent.id, "run-execution");
            expect(context.execution?.operations[0]).toMatchObject({
                undoAvailable: false,
                effects: [
                    { key: "note", status: "applied" },
                    { key: "attachment", status: "removed" },
                ],
            });
            const undo = await h.session.undoMany(result.operations.flatMap(operation =>
                operation.receiptId ? [operation.receiptId] : []));
            expect(undo[0]).toMatchObject({ status: "expired" });
        } finally {
            h.service.dispose();
            jest.useRealTimers();
        }
    });

    it("preserves the applied-note fact when disposal occurs during the note write", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const historyService = new ChatService({ log: jest.fn() } as never, h.session);
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        await manager.initialize();
        const pending = pendingAction(intent.id);
        const conversation = await manager.startConversation("Remove the fixture image");
        await store.appendTurn({ conversationId: conversation.id, turnIndex: 0,
            user: { role: "user", content: "Remove the fixture image" },
            assistant: { role: "assistant", content: "Review the proposal", actionStates: [pending],
                actionStateBinding: { conversationId: conversation.id, turnIndex: 0,
                    runId: pending.origin.runId, turnId: pending.origin.turnId } } });
        historyService.registerOperationsContextPersistence(intent.id, async execution => {
            await manager.updateActionStatesForOperation(conversation.id, pending.origin.runId, "operations", intent.id,
                states => states.map(state => execution
                    ? applyOperationsExecutionResult(state, execution) ?? state
                    : historyService.refreshOperationsActionState(state)));
        });
        let releaseProcess!: () => void;
        const originalProcess = h.vault.process.getMockImplementation();
        if (!originalProcess) throw new Error("missing process implementation");
        let noteWriteStarted!: () => void;
        const started = new Promise<void>(resolve => { noteWriteStarted = resolve; });
        h.vault.process.mockImplementation(async (file, change) => {
            const written = await originalProcess(file, change);
            noteWriteStarted();
            await new Promise<void>(resolve => { releaseProcess = resolve; });
            return written;
        });
        const confirmed = historyService.confirmOperationsIntent(intent.id);
        await started;
        historyService.dispose();
        h.service.dispose();
        releaseProcess();
        const result = await confirmed;
        expect(result.state).toBe("partial");
        expect(result.operations[0]).toMatchObject({
            status: "partial",
            undoAvailable: false,
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "not_started" },
            ],
        });
        expect(typeof result.operations[0].receiptId).toBe("string");
        expect(result.operations[0].receiptId?.length).toBeGreaterThan(0);
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(true);
        expect(h.vault.trashFile).not.toHaveBeenCalled();
        const lateState = (await store.getTurns(conversation.id))[0].assistant.actionStates![0];
        expect(lateState.phase).toBe("partial");
        expect(lateState.actions?.map(action => `${action.effect?.key}:${action.effect?.status}`))
            .toEqual(["note:applied", "attachment:not_started"]);
        expect(lateState.operationsUndoAvailable).toBe(false);
        expect(historyService.getVisibleOperationsStatus(intent.id, "run-execution")).toMatchObject({
            available: false,
            undoAvailable: false,
        });
    });

    it("persists an Agent-initiated execution that settles after ChatService disposal", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const historyService = new ChatService({ log: jest.fn() } as never, h.session);
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        await manager.initialize();
        const pending = pendingAction(intent.id);
        const conversation = await manager.startConversation("Remove the fixture image");
        await store.appendTurn({ conversationId: conversation.id, turnIndex: 0,
            user: { role: "user", content: "Remove the fixture image" },
            assistant: { role: "assistant", content: "Review the proposal", actionStates: [pending],
                actionStateBinding: { conversationId: conversation.id, turnIndex: 0,
                    runId: pending.origin.runId, turnId: pending.origin.turnId } } });
        historyService.registerOperationsContextPersistence(intent.id, async execution => {
            await manager.updateActionStatesForOperation(conversation.id, pending.origin.runId, "operations", intent.id,
                states => states.map(state => execution
                    ? applyOperationsExecutionResult(state, execution) ?? state
                    : historyService.refreshOperationsActionState(state)));
        });
        let releaseProcess!: () => void;
        const originalProcess = h.vault.process.getMockImplementation();
        if (!originalProcess) throw new Error("missing process implementation");
        let noteWriteStarted!: () => void;
        const started = new Promise<void>(resolve => { noteWriteStarted = resolve; });
        h.vault.process.mockImplementationOnce(async (file, change) => {
            const written = await originalProcess(file, change);
            noteWriteStarted();
            await new Promise<void>(resolve => { releaseProcess = resolve; });
            return written;
        });
        const executed = historyService.executeOperationsIntentFromAgent({
            intentId: intent.id,
            runId: "run-execution",
            taskSourceReadGuard: h.guard,
        });
        await started;
        historyService.dispose();
        h.service.dispose();
        releaseProcess();
        const result = await executed;
        expect(result.state).toBe("partial");
        const lateState = (await store.getTurns(conversation.id))[0].assistant.actionStates![0];
        expect(lateState).toMatchObject({ phase: "partial", operationsUndoAvailable: false });
        expect(historyService.getVisibleOperationsStatus(intent.id, "run-execution")).toMatchObject({
            available: false,
            undoAvailable: false,
        });
    });

    it("settles a completed Trash call during disposal without claiming Undo remains available", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        let releaseTrash!: () => void;
        let trashStarted!: () => void;
        const started = new Promise<void>(resolve => { trashStarted = resolve; });
        h.vault.trashFile.mockImplementation(async file => {
            trashStarted();
            await new Promise<void>(resolve => { releaseTrash = resolve; });
            if (file.path !== ATTACHMENT_PATH) throw new Error("unexpected file");
            h.vault.completeTrash();
        });
        const confirmed = h.session.confirm(intent.id);
        await started;
        h.service.dispose();
        releaseTrash();
        const result = await confirmed;
        expect(result.state).toBe("completed");
        expect(result.operations[0]).toMatchObject({
            status: "succeeded",
            undoAvailable: false,
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "removed" },
            ],
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(false);
    });

    it("rechecks source authority after awaited binary preparation and writes nothing when revoked", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const originalRead = h.readAttachmentFile.getMockImplementation();
        if (!originalRead) throw new Error("missing attachment read implementation");
        let releaseRead!: () => void;
        let readStarted!: () => void;
        const started = new Promise<void>(resolve => { readStarted = resolve; });
        h.readAttachmentFile.mockImplementation(async file => {
            readStarted();
            await new Promise<void>(resolve => { releaseRead = resolve; });
            return await originalRead(file);
        });
        const confirmed = h.session.confirm(intent.id);
        await started;
        h.revokeAncestor();
        releaseRead();
        const result = await confirmed;
        expect(result.state).toBe("failed");
        expect(result.operations[0]?.effects?.[0]).toMatchObject({
            key: "note",
            status: "failed",
            failureCategory: "boundary_denied",
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(BEFORE);
        expect(h.vault.process).not.toHaveBeenCalled();
        expect(h.vault.trashFile).not.toHaveBeenCalled();
    });

    it("reports attachment deletion as not started when the final read rejects after disposal", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const originalRead = h.readAttachmentFile.getMockImplementation();
        if (!originalRead) throw new Error("missing attachment read implementation");
        let reads = 0;
        h.readAttachmentFile.mockImplementation(async file => {
            if (++reads === 3) {
                h.service.dispose();
                throw new Error("read rejected after disposal");
            }
            return await originalRead(file);
        });
        const result = await h.session.confirm(intent.id);
        expect(result.state).toBe("partial");
        expect(result.operations[0]).toMatchObject({ status: "partial", undoAvailable: false,
            effects: [{ key: "note", status: "applied" }, { key: "attachment", status: "not_started" }] });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(true);
        expect(h.vault.trashFile).not.toHaveBeenCalled();
    });

    it("stops before restoring an attachment when source authority is revoked during the awaited read", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const result = await h.session.confirm(intent.id);
        const binaryReadsBeforeUndo = h.readAttachmentFile.mock.calls.length;
        let releaseRead!: () => void;
        let readStarted!: () => void;
        const started = new Promise<void>(resolve => { readStarted = resolve; });
        const originalReadSource = h.vault.read.getMockImplementation();
        if (!originalReadSource) throw new Error("missing source read implementation");
        h.vault.read.mockImplementation(async file => {
            readStarted();
            await new Promise<void>(resolve => { releaseRead = resolve; });
            return await originalReadSource(file);
        });
        const undoing = h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        await started;
        h.revokeAncestor();
        releaseRead();
        const undo = await undoing;
        expect(undo[0]).toMatchObject({ status: "unavailable", failureCategory: "boundary_denied" });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(false);
        expect(h.readAttachmentFile).toHaveBeenCalledTimes(binaryReadsBeforeUndo);
        expect(h.restoreAttachmentFile).not.toHaveBeenCalled();
    });

    it("stops before Trash when disposal occurs during the final attachment verification read", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const originalRead = h.readAttachmentFile.getMockImplementation();
        if (!originalRead) throw new Error("missing attachment read implementation");
        let releaseRead!: () => void;
        let finalReadStarted!: () => void;
        const started = new Promise<void>(resolve => { finalReadStarted = resolve; });
        let readCount = 0;
        h.readAttachmentFile.mockImplementation(async file => {
            readCount += 1;
            if (readCount < 3) return await originalRead(file);
            finalReadStarted();
            await new Promise<void>(resolve => { releaseRead = resolve; });
            return await originalRead(file);
        });
        const confirmed = h.session.confirm(intent.id);
        await started;
        h.service.dispose();
        releaseRead();
        const disposedResult = await confirmed;
        expect(disposedResult.state).toBe("partial");
        expect(disposedResult.operations[0]).toMatchObject({
            undoAvailable: false,
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "not_started" },
            ],
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(true);
        expect(h.vault.trashFile).not.toHaveBeenCalled();
    });

    it("preserves an attachment-restored checkpoint when disposal occurs during restore", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const result = await h.session.confirm(intent.id);
        const originalRestore = h.restoreAttachmentFile.getMockImplementation();
        if (!originalRestore) throw new Error("missing restore implementation");
        let releaseRestore!: () => void;
        let restoreStarted!: () => void;
        const started = new Promise<void>(resolve => { restoreStarted = resolve; });
        h.restoreAttachmentFile.mockImplementation(async (file, bytes) => {
            restoreStarted();
            await new Promise<void>(resolve => { releaseRestore = resolve; });
            return await originalRestore(file, bytes);
        });
        const undoing = h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        await started;
        h.service.dispose();
        releaseRestore();
        const undo = await undoing;
        expect(undo[0]).toMatchObject({
            status: "unavailable",
            failureCategory: "cancelled",
            checkpoint: "attachment-restored",
            undoAvailable: false,
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "restored" },
            ],
        });
        expect(h.vault.notes.get(NOTE_PATH)).toBe(AFTER);
        expect(h.vault.attached).toBe(true);
    });

    it("refreshes persisted compound owner facts through ChatService for undo, checkpoint, and TTL", async () => {
        const h = await fixture();
        const intent = await h.stage("delete");
        const result = await h.session.confirm(intent.id);
        const service = new ChatService({} as never, h.session);
        const applied = service.refreshOperationsActionState(pendingAction(intent.id));
        expect(applied.phase).toBe("completed");
        expect(applied.operationsUndoAvailable).toBe(true);
        expect(applied.actions).toEqual([
            expect.objectContaining({ effect: { key: "note", status: "applied" }, phase: "applied" }),
            expect.objectContaining({ effect: { key: "attachment", status: "removed" }, phase: "applied" }),
        ]);
        expect(service.refreshOperationsActionState(applied).revision).toBe(applied.revision);

        await h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        const undone = service.refreshOperationsActionState(applied);
        expect(undone.phase).toBe("undone");
        expect(undone.operationsUndoAvailable).toBe(false);
        expect(undone.actions?.map(action => action.effect?.status)).toEqual(["restored", "restored"]);
        expect(undone.actions?.every(action => action.phase === "undone")).toBe(true);
        expect(service.refreshOperationsActionState(undone).revision).toBe(undone.revision);
    });

    it("keeps a partial recovery checkpoint and current Undo availability in ChatService history", async () => {
        jest.useFakeTimers();
        const h = await fixture();
        const intent = await h.stage("delete");
        const result = await h.session.confirm(intent.id);
        const originalRestore = h.restoreAttachmentFile.getMockImplementation();
        if (!originalRestore) throw new Error("missing restore implementation");
        h.restoreAttachmentFile.mockImplementation(async (file, bytes) => {
            h.vault.notes.set(NOTE_PATH, `${AFTER}User edit`);
            return await originalRestore(file, bytes);
        });
        await h.session.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        const service = new ChatService({} as never, h.session);
        const checkpoint = service.refreshOperationsActionState(pendingAction(intent.id));
        expect(checkpoint.phase).toBe("partial");
        expect(checkpoint.operationsUndoAvailable).toBe(true);
        expect(checkpoint.actions?.map(action => `${action.effect?.key}:${action.effect?.status}:${action.phase}`))
            .toEqual(["note:applied:applied", "attachment:restored:undone"]);
        expect(checkpoint.actions?.[1]).toMatchObject({ checkpoint: "attachment-restored" });
        try {
            jest.advanceTimersByTime(30 * 60 * 1_000 + 1);
            const expiredCheckpoint = service.refreshOperationsActionState(checkpoint);
            expect(expiredCheckpoint.phase).toBe("partial");
            expect(expiredCheckpoint.actions?.map(action => action.effect?.status))
                .toEqual(["applied", "restored"]);
            expect(expiredCheckpoint.operationsUndoAvailable).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    it("reports expired compound Undo capability without downgrading completed effects", async () => {
        jest.useFakeTimers();
        const h = await fixture();
        try {
            const intent = await h.stage("delete");
            await h.session.confirm(intent.id);
            jest.advanceTimersByTime(30 * 60 * 1_000 + 1);
            const service = new ChatService({} as never, h.session);
            const expired = service.refreshOperationsActionState(pendingAction(intent.id));
            expect(expired.phase).toBe("completed");
            expect(expired.operationsUndoAvailable).toBe(false);
            expect(expired.actions?.map(action => `${action.effect?.key}:${action.effect?.status}`))
                .toEqual(["note:applied", "attachment:removed"]);
        } finally {
            jest.useRealTimers();
        }
    });
});
