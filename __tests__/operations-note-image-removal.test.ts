import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import type {
    PaAgentToolBatchPreparationInput,
    PaAgentToolExecutor,
    ParsedBufferedToolCall,
} from "../src/ai-services/pa-agent-types";
import { OperationsIntentController } from "../src/ai-services/operations/operations-intent-controller";
import { NoteImageRemovalResourceOwner } from "../src/ai-services/operations/note-image-removal-resources";
import { createOperationsStagingToolExecutor } from "../src/ai-services/operations/operations-tool-executor";
import { OPERATIONS_BLOCKED_MESSAGE, OperationsToolProvider } from "../src/ai-services/operations/operations-tool-provider";
import { collectActionStates, cloneActionStates, projectActionSummaryFacts } from "../src/ai-services/pa-agent-result-facts";
import { completeInputLineage } from "../src/ai-services/input-lineage";
import type { NoteImageRemovalHost } from "../src/ai-services/operations/note-image-removal";
import { TaskSourceConstraintState } from "../src/ai-services/task-source-constraint";
import type { TaskSourceReadGuard } from "../src/ai-services/task-source-read-guard";
import type {
    OperationsVault,
    OperationsVaultFile,
} from "../src/ai-services/operations/types";

const NOTE_PATH = "notes/b160-featured-image.md";
const ATTACHMENT_PATH = "assets/b160-original.png";
const IMAGE_REFERENCE = "![[assets/b160-original.png]]";
const ORIGINAL_ATTACHMENT_BYTES = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const NOTE_BEFORE = [
    "> [!featured-image]",
    "> Caption for the selected image.",
    `> ${IMAGE_REFERENCE}`,
    "> Unrelated callout text must remain.",
    "",
    "The note body remains.",
].join("\n");
const NOTE_AFTER = [
    "> [!featured-image]",
    "> Caption for the selected image.",
    "> Unrelated callout text must remain.",
    "",
    "The note body remains.",
].join("\n");

class NoteImageRemovalVault implements OperationsVault {
    readonly notes = new Map([[NOTE_PATH, NOTE_BEFORE]]);
    readonly folders = new Set(["notes", "assets"]);
    readonly attachment: OperationsVaultFile & { bytes: Uint8Array } = {
        path: ATTACHMENT_PATH,
        extension: "png",
        bytes: ORIGINAL_ATTACHMENT_BYTES,
    };

    readonly adapter = {
        exists: jest.fn(async (path: string) => (
            this.notes.has(path) || path === ATTACHMENT_PATH || this.folders.has(path)
        )),
    };

    readonly cachedRead = jest.fn(async (file: OperationsVaultFile) => {
        const note = this.notes.get(file.path);
        if (note === undefined) throw new Error("missing note");
        return note;
    });
    readonly read = jest.fn(async (file: OperationsVaultFile) => this.notes.get(file.path) ?? "");

    readonly create = jest.fn(async (path: string, content: string) => {
        if (this.notes.has(path) || this.folders.has(path)) throw new Error("collision");
        this.notes.set(path, content);
        return { path, extension: "md" };
    });

    readonly process = jest.fn(async (file: OperationsVaultFile, change: (current: string) => string) => {
        const current = this.notes.get(file.path);
        if (current === undefined) throw new Error("missing note");
        const next = change(current);
        this.notes.set(file.path, next);
        return { path: file.path, extension: "md" };
    });

    readonly trashAttachment = jest.fn(async (file: OperationsVaultFile) => {
        if (file.path !== ATTACHMENT_PATH) throw new Error("not the selected attachment");
        this.attached = false;
    });

    attached = true;

    getAbstractFileByPath(path: string): OperationsVaultFile | null {
        const note = this.notes.get(path);
        if (note !== undefined) return { path, extension: "md" };
        if (path === ATTACHMENT_PATH && this.attached) return this.attachment;
        if (this.folders.has(path)) return { path, children: [] };
        return null;
    }
}

function makeController(
    vault: NoteImageRemovalVault,
    options: Partial<ConstructorParameters<typeof OperationsIntentController>[0]> = {},
): OperationsIntentController {
    let id = 0;
    return new OperationsIntentController({
        vault,
        trashFile: async (file) => await vault.trashAttachment(file),
        createId: () => `b160-${++id}`,
        ...options,
    });
}

function makeGuard(): TaskSourceReadGuard {
    const state = new TaskSourceConstraintState({
        runId: "b160-red-run",
        userMessageId: "b160-user",
        userText: "Remove this featured image and its attachment.",
        noteHandles: new Map([["current", "note-b160"]]),
    });
    return state.createReadGuard(
        state.snapshot(),
        path => path === NOTE_PATH ? "note-b160" : undefined,
        () => true,
        undefined,
        () => ({ allowedPaths: null, excludedPaths: [] }),
        undefined,
        undefined,
        () => true,
    );
}

function makeNoteImageHost(vault: NoteImageRemovalVault): NoteImageRemovalHost {
    const noteFile = { path: NOTE_PATH };
    return {
        getSourceFile: path => path === NOTE_PATH
            ? { path, extension: "md", file: noteFile, version: { mtime: 1, size: NOTE_BEFORE.length } }
            : undefined,
        listSourceFiles: () => [
            { path: NOTE_PATH, extension: "md", file: noteFile, version: { mtime: 1, size: NOTE_BEFORE.length } },
        ],
        readSourceFile: async () => vault.notes.get(NOTE_PATH) ?? "",
        parseLinktext: linktext => ({ path: linktext, subpath: "" }),
        resolveImageDestination: linkpath => linkpath === ATTACHMENT_PATH && vault.attached
            ? {
                path: ATTACHMENT_PATH,
                extension: "png",
                file: vault.attachment,
                version: { mtime: 1, size: ORIGINAL_ATTACHMENT_BYTES.byteLength },
            }
            : undefined,
        isPathAllowed: () => true,
        isAttachmentPathAllowed: () => true,
        readAttachmentFile: async () => ORIGINAL_ATTACHMENT_BYTES.slice().buffer,
        getAttachmentFileByPath: path => path === ATTACHMENT_PATH && vault.attached
            ? {
                path: ATTACHMENT_PATH,
                extension: "png",
                file: vault.attachment,
                version: { mtime: 1, size: ORIGINAL_ATTACHMENT_BYTES.byteLength },
            }
            : undefined,
        restoreAttachmentFile: async () => {
            vault.attached = true;
            return {
                path: ATTACHMENT_PATH,
                extension: "png",
                file: vault.attachment,
                version: { mtime: 1, size: ORIGINAL_ATTACHMENT_BYTES.byteLength },
            };
        },
    };
}

describe("B-160 note image removal", () => {
    it("carries a real blocked tool proposal into finite history facts without disclosing reference paths", async () => {
        const vault = new NoteImageRemovalVault();
        vault.notes.set(NOTE_PATH, `${NOTE_BEFORE}\n[Another reference](${ATTACHMENT_PATH})`);
        const controller = makeController(vault, {
            noteImageRemovalHost: makeNoteImageHost(vault),
            noteImageRemovalResources: new NoteImageRemovalResourceOwner(),
        });
        try {
            const registry = new CapabilityRegistry({ policyEngine: new PolicyEngine({
                runKind: "chat-with-actions", allowWrite: true,
                allowedActionPermissions: ["local-filesystem-write"],
            }) });
            registry.registerMany((await new OperationsToolProvider().load({
                turnId: "blocked-turn", platform: "desktop", settings: { operationsAgentEnabled: true },
            })).capabilities);
            const executor = createOperationsStagingToolExecutor({
                baseExecutor: { execute: jest.fn() }, registry, controller,
            });
            const call: ParsedBufferedToolCall = { type: "toolCall", id: "blocked-call", index: 0,
                name: "remove_note_image", input: { notePath: NOTE_PATH,
                    imageReference: IMAGE_REFERENCE, attachmentAction: "delete" } };
            const prepared = await executor.prepareBatch!({ runId: "b160-red-run", turnId: "blocked-turn",
                turnIndex: 0, userInput: "Remove the image and its attachment.", toolCalls: [call],
                taskSourceReadGuard: makeGuard(), signal: new AbortController().signal });
            const result = prepared?.toolResults.get(call.id)!;
            const intent = controller.listPendingIntents()[0];
            expect(result).toMatchObject({ promptText: OPERATIONS_BLOCKED_MESSAGE,
                metadata: { staged: true, wrote: false, blockedReason: "shared_reference" } });
            expect(intent.operations[0]).toMatchObject({ block: { reason: "shared_reference",
                conflicts: [{ sourcePath: NOTE_PATH }] } });
            expect(JSON.stringify(result)).not.toContain(NOTE_PATH);
            expect(JSON.stringify(result)).not.toContain(ATTACHMENT_PATH);
            const states = collectActionStates({ runId: intent.runId, turnId: intent.turnId, messages: [
                { role: "assistant", id: "blocked-assistant", timestamp: 1, content: [call] },
                { role: "toolResult", id: "blocked-result", toolCallId: call.id, toolName: call.name,
                    isError: false, timestamp: 2,
                    inputLineage: completeInputLineage([{ kind: "user-text", messageId: "b160-user" }]),
                    content: { promptText: result.promptText, previewText: result.previewText,
                        resultFact: result.resultFact, includeInNextPrompt: true,
                        metadata: { ...result.metadata, originalLength: result.promptText.length,
                            observationChars: result.promptText.length } } },
            ] });
            const restored = cloneActionStates(JSON.parse(JSON.stringify(states)));
            expect(restored).toHaveLength(1);
            expect(projectActionSummaryFacts(restored)[0]).toMatchObject({ phase: "pending",
                operationsBlockedReason: "shared_reference" });
            await expect(controller.executeIntent(intent.id)).rejects.toThrow("blocked by a shared image reference");
            expect(vault.process).not.toHaveBeenCalled();
            expect(vault.trashAttachment).not.toHaveBeenCalled();
        } finally {
            controller.dispose();
        }
    });
    it("records the current vault_process baseline: the selected reference is removed but the attachment remains", async () => {
        const vault = new NoteImageRemovalVault();
        const controller = makeController(vault);

        const intent = await controller.stageIntent({
            runId: "b160-baseline-run",
            turnId: "b160-baseline-stage",
            operations: [{
                toolCallId: "b160-baseline-call",
                name: "vault_process",
                input: {
                    path: NOTE_PATH,
                    operation: "replace",
                    params: { search: `> ${IMAGE_REFERENCE}\n`, replace: "" },
                },
            }],
        });

        expect(intent.operations[0]).toMatchObject({
            expectedBefore: NOTE_BEFORE,
            expectedAfter: NOTE_AFTER,
        });
        expect(vault.process).not.toHaveBeenCalled();
        expect(vault.notes.get(NOTE_PATH)).toBe(NOTE_BEFORE);

        const result = await controller.executeIntent(intent.id);

        expect(result.state).toBe("completed");
        expect(vault.notes.get(NOTE_PATH)).toBe(NOTE_AFTER);
        expect(vault.notes.get(NOTE_PATH)).toContain("Unrelated callout text must remain.");
        expect(vault.getAbstractFileByPath(ATTACHMENT_PATH)).toBe(vault.attachment);
        expect(vault.attachment.bytes).toEqual(ORIGINAL_ATTACHMENT_BYTES);
        expect(vault.trashAttachment).not.toHaveBeenCalled();

        controller.dispose();
    });

    it("requires remove_note_image at the real tool boundary to stage the joint note-and-attachment proposal", async () => {
        const vault = new NoteImageRemovalVault();
        const noteImageRemovalResources = new NoteImageRemovalResourceOwner();
        const controller = makeController(vault, {
            noteImageRemovalHost: makeNoteImageHost(vault),
            noteImageRemovalResources,
        });
        const registry = new CapabilityRegistry({
            policyEngine: new PolicyEngine({
                runKind: "chat-with-actions",
                allowWrite: true,
                allowedActionPermissions: ["local-filesystem-write"],
            }),
        });
        const loaded = await new OperationsToolProvider().load({
            turnId: "b160-red-turn",
            platform: "desktop",
            settings: { operationsAgentEnabled: true },
        });
        registry.registerMany(loaded.capabilities);
        const baseExecutor: PaAgentToolExecutor = {
            execute: jest.fn(async () => ({ outcome: "success" as const, promptText: "base executor" })),
        };
        const executor = createOperationsStagingToolExecutor({
            baseExecutor,
            registry,
            controller,
        });
        const taskSourceReadGuard = makeGuard();
        const removeCall: ParsedBufferedToolCall = {
            type: "toolCall",
            id: "b160-remove-call",
            index: 0,
            name: "remove_note_image",
            input: {
                notePath: NOTE_PATH,
                imageReference: IMAGE_REFERENCE,
                attachmentAction: "delete",
            },
        };
        const batch: PaAgentToolBatchPreparationInput = {
            runId: "b160-red-run",
            turnId: "b160-red-turn",
            turnIndex: 0,
            userInput: "Remove this featured image and its attachment.",
            toolCalls: [removeCall],
            taskSourceReadGuard,
            signal: new AbortController().signal,
        };

        const preparation = await executor.prepareBatch?.(batch);
        const toolResult = preparation?.toolResults.get(removeCall.id);

        expect(toolResult).toMatchObject({
            outcome: "success",
            metadata: { staged: true, wrote: false },
        });
        const intent = controller.listPendingIntents()[0];
        expect(intent?.operations.map((operation) => operation.name)).toEqual(["remove_note_image"]);
        expect(intent?.operations[0]).toMatchObject({
            path: NOTE_PATH,
            input: {
                notePath: NOTE_PATH,
                imageReference: IMAGE_REFERENCE,
                attachmentAction: "delete",
            },
        });
        expect(vault.notes.get(NOTE_PATH)).toBe(NOTE_BEFORE);
        expect(vault.getAbstractFileByPath(ATTACHMENT_PATH)).toBe(vault.attachment);
        expect(vault.attachment.bytes).toEqual(ORIGINAL_ATTACHMENT_BYTES);
        expect(vault.process).not.toHaveBeenCalled();
        expect(vault.trashAttachment).not.toHaveBeenCalled();

        const result = await controller.executeIntent(intent.id);
        expect(result.state).toBe("completed");
        expect(result.operations[0]).toMatchObject({
            status: "succeeded",
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "removed" },
            ],
            undoAvailable: true,
        });
        const undo = await controller.undoMany(result.operations.flatMap(operation =>
            operation.receiptId ? [operation.receiptId] : []));
        expect(undo[0]).toMatchObject({ status: "undone" });
        expect(vault.notes.get(NOTE_PATH)).toBe(NOTE_BEFORE);
        expect(vault.attached).toBe(true);
        expect(vault.attachment.bytes).toEqual(ORIGINAL_ATTACHMENT_BYTES);

        controller.dispose();
    });
});
