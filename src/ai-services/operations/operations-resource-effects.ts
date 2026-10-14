import { getPlatformCrypto } from "../../platform-dom";
import { createCooperativeTask } from "../cooperative-task";
import { isObsidianTextPath } from "../independent-computation/obsidian-resource-sdk";
import { resourceAction } from "./resource-input-validation";
import { parentVaultPath, validateResourceVaultPath } from "./vault-path";
import type { TaskSourceReadGuard } from "../task-source-read-guard";
import type { NoteImageRemovalResourceOwner, NoteImageRemovalReservation } from "./note-image-removal-resources";
import type { OperationsUndoStore } from "./operations-undo-store";
import type {
    OperationExecutionResult, OperationsFailureCategory, OperationsIntent, OperationsResourceContext,
    OperationsVault, OperationsVaultFile, PreparedResourceOperation, ResourceOperationInput,
    ResourceOperationToolName, ResourceTreeEntry, SnapshotEdit, UndoReceipt, UndoResult, ResourceEffectFacts,
} from "./types";

/** Live private byte retention, shared with the existing session recovery owner. */
export const MAX_RESOURCE_RECOVERY_BYTES = 8 * 1024 * 1024;
export class OperationsResourceError extends Error {
    constructor(readonly category: OperationsFailureCategory, message: string) { super(message); }
}
export interface ResourceEffectHost {
    vault: OperationsVault; undoStore: OperationsUndoStore; recoveryOwner: NoteImageRemovalResourceOwner;
    renameFile?: (file: OperationsVaultFile, path: string) => Promise<void>;
    trashResource?: (file: OperationsVaultFile) => Promise<void>;
    removeEmptyFolder?: (file: OperationsVaultFile) => Promise<void>;
    createId(): string; isActive(): boolean;
    assertAllowed(path: string, output?: boolean): void;
    guard?: TaskSourceReadGuard; signal?: AbortSignal;
    undo?(receiptId: string): Promise<UndoResult>;
    markSelfWrite?(path: string): void;
}
export type ResourceRecovery =
    | { kind: "snapshot"; tree: ResourceTreeEntry[]; reservation: NoteImageRemovalReservation }
    | { kind: "capacity_exceeded" };
function fail(category: OperationsFailureCategory, message: string): never { throw new OperationsResourceError(category, message); }
const isFolder = (file: OperationsVaultFile): boolean => Array.isArray(file.children);
const live = (host: ResourceEffectHost, file: OperationsVaultFile, path = file.path): boolean =>
    file.path === path && host.vault.getAbstractFileByPath(path) === file;
async function readText(host: ResourceEffectHost, file: OperationsVaultFile, output = false): Promise<string> {
    host.assertAllowed(file.path, output);
    if (host.vault.readBinary) {
        const data = await bytes(host, file, output);
        try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); }
        catch { return fail("path_rejected", "The saved resource is not valid UTF-8 text."); }
    }
    if (!host.vault.read) return fail("fs_error", "Fresh text reading is unavailable.");
    const text = await host.vault.read(file);
    host.assertAllowed(file.path, output);
    return text;
}
async function hash(bytes: ArrayBuffer): Promise<string> {
    const crypto = getPlatformCrypto();
    if (!crypto?.subtle) return fail("fs_error", "Content verification is unavailable.");
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function bytes(host: ResourceEffectHost, file: OperationsVaultFile, output = false): Promise<ArrayBuffer> {
    host.assertAllowed(file.path, output);
    if (!host.vault.readBinary) return fail("fs_error", "Binary reading is unavailable.");
    const data = await host.vault.readBinary(file);
    host.assertAllowed(file.path, output);
    return data;
}
function treeMetadataBytes(item: ResourceTreeEntry): number {
    return new TextEncoder().encode(JSON.stringify({ path: item.path, kind: item.kind,
        stat: item.stat, contentHash: item.contentHash })).byteLength;
}
function treeBytes(tree: readonly ResourceTreeEntry[]): number {
    for (const entry of tree) {
        if (entry.kind === "file" && (!Number.isSafeInteger(entry.stat?.size) || (entry.stat?.size ?? -1) < 0)) {
            fail("fs_error", "The file's recovery size is unavailable.");
        }
    }
    // Reserve the SHA-256 field before reading bytes; snapshots add it during capture.
    return tree.reduce((sum, item) => sum + (item.bytes?.byteLength ?? item.stat?.size ?? 0)
        + treeMetadataBytes(item.kind === "file" ? { ...item, contentHash: "0".repeat(64) } : item), 0);
}
async function tree(host: ResourceEffectHost, root: OperationsVaultFile, content: boolean): Promise<ResourceTreeEntry[]> {
    const result: ResourceTreeEntry[] = [];
    const task = createCooperativeTask(host.signal);
    let retained = 0;
    const visit = async (file: OperationsVaultFile): Promise<void> => {
        await task.checkpoint(); host.assertAllowed(file.path);
        if (!live(host, file)) fail("stale_target", "A resource changed during preparation.");
        const entry: ResourceTreeEntry = { path: file.path, file, kind: isFolder(file) ? "folder" : "file", ...(file.stat ? { stat: { ...file.stat } } : {}) };
        if (entry.kind === "file" && content) entry.contentHash = await hash(await bytes(host, file));
        // Tree verification retains only metadata and hashes. File bytes are read
        // one at a time; trash reserves their cumulative backup separately.
        retained += treeMetadataBytes(entry);
        if (retained > MAX_RESOURCE_RECOVERY_BYTES) fail("undo_unavailable", "The tree metadata exceeds available recovery resources.");
        host.assertAllowed(entry.path);
        if (!live(host, file, entry.path)) fail("stale_target", "A resource changed during preparation.");
        result.push(entry);
        if (isFolder(file)) for (const child of [...file.children as OperationsVaultFile[]]) await visit(child);
    };
    await visit(root);
    return result;
}
async function assertTree(host: ResourceEffectHost, expected: readonly ResourceTreeEntry[]): Promise<void> {
    const root = expected[0];
    if (!root || !live(host, root.file, root.path)) fail("stale_target", "The original tree is no longer present.");
    const current = await tree(host, root.file, expected.some(e => !!e.contentHash));
    if (current.length !== expected.length || current.some((entry, i) => entry.file !== expected[i].file
        || entry.path !== expected[i].path || entry.contentHash !== expected[i].contentHash)) fail("stale_target", "The tree changed after preparation.");
}
function assertParent(host: ResourceEffectHost, path: string, parent?: OperationsVaultFile | null): void {
    const p = parentVaultPath(path);
    if (!p) return;
    const current = host.vault.getAbstractFileByPath(p);
    if (!current || !isFolder(current)) fail("parent_missing", "The target parent folder is missing.");
    if (parent !== undefined && current !== parent) fail("stale_target", "The target parent changed.");
}
export function validateSnapshotEdits(before: string, edits: readonly SnapshotEdit[]): { edits: SnapshotEdit[]; after: string } {
    const sorted = edits.map(e => ({ ...e })).sort((a, b) => a.from - b.from || a.to - b.to);
    const insidePair = (offset: number): boolean => offset > 0 && offset < before.length
        && (before[offset - 1] === "\r" && before[offset] === "\n"
            || before.charCodeAt(offset - 1) >= 0xd800 && before.charCodeAt(offset - 1) <= 0xdbff
                && before.charCodeAt(offset) >= 0xdc00 && before.charCodeAt(offset) <= 0xdfff);
    for (let i = 0; i < sorted.length; i++) {
        const edit = sorted[i]; const prior = sorted[i - 1];
        if (edit.from > edit.to || edit.to > before.length || insidePair(edit.from) || insidePair(edit.to)) fail("schema_invalid", "An edit range is invalid in the original UTF-16 snapshot.");
        if (prior && (edit.from < prior.to || edit.from === prior.to && (edit.from === edit.to || prior.from === prior.to))) fail("schema_invalid", "Edits overlap or have ambiguous insertion boundaries.");
    }
    let after = before;
    for (const edit of [...sorted].reverse()) after = after.slice(0, edit.from) + edit.text + after.slice(edit.to);
    return { edits: sorted, after };
}
export async function prepareResourceOperation(host: ResourceEffectHost, input: {
    name: ResourceOperationToolName; input: ResourceOperationInput; toolCallId: string; context?: OperationsResourceContext;
}): Promise<PreparedResourceOperation> {
    const action = resourceAction(input.name); const args = input.input; const context = input.context;
    let path = args.path ?? ""; let before: string | null = null; let after = "";
    let resource: PreparedResourceOperation["resource"];
    if (action === "create") {
        host.assertAllowed(path, true);
        if (!isObsidianTextPath(path)) fail("path_rejected", "This resource is a binary format, not a text target.");
        if (host.vault.getAbstractFileByPath(path)) fail("target_collision", "The target already exists.");
        assertParent(host, path);
        after = args.text!;
        resource = { action, parent: host.vault.getAbstractFileByPath(parentVaultPath(path)), text: after, context };
    } else if (action === "mkdir") {
        host.assertAllowed(path, true);
        const prefixes = path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));
        const paths: string[] = []; const parents: Array<{ path: string; file: OperationsVaultFile }> = [];
        for (const prefix of prefixes) {
            host.assertAllowed(prefix, true);
            const file = host.vault.getAbstractFileByPath(prefix);
            if (file) { if (!isFolder(file)) fail("target_collision", "A file occupies a required folder path."); parents.push({ path: prefix, file }); }
            else paths.push(prefix);
        }
        if (!args.parents && paths.some(p => p !== path)) fail("parent_missing", "The parent folder must exist.");
        resource = { action, paths, parents, context };
    } else if (action === "editor") {
        const binding = context?.resolveWorkspaceSnapshot(args.snapshotId!, host.guard, host.signal);
        if (!binding || !binding.isLive() || binding.readBuffer() !== binding.before) fail("stale_target", "The original editor snapshot is no longer current.");
        path = binding!.path; host.assertAllowed(path);
        before = binding!.before;
        const edits = validateSnapshotEdits(before, args.edits!); after = edits.after;
        resource = { action, binding: binding!, before, after, edits: edits.edits };
    } else if (action === "undo") {
        const lookup = host.undoStore.get(args.receiptId!);
        if (!lookup.ok) fail("undo_unavailable", "The receipt is unavailable in this Operations session.");
        path = lookup.receipt.resource?.action === "editor" ? lookup.receipt.resource.binding.path : lookup.receipt.path;
        host.assertAllowed(path, true);
        resource = { action, receiptId: args.receiptId! };
    } else {
        const target = args.source ?? args.target!;
        const resolved = context ? await context.resolveTarget(target, host.guard, host.signal)
            : "path" in target ? (() => { const file = host.vault.getAbstractFileByPath(target.path!); return file ? { file, path: file.path } : undefined; })() : undefined;
        if (!resolved) fail("target_missing", "The original resource is unavailable.");
        path = validateResourceVaultPath(resolved!.path); const file = resolved!.file as OperationsVaultFile;
        host.assertAllowed(path);
        if (!live(host, file, path)) fail("stale_target", "The target object changed.");
        if (action === "replace") {
            if (isFolder(file) || !isObsidianTextPath(path)) fail("path_rejected", "Only text files can be replaced.");
            const snapshot = await context?.getReadSnapshot(args.expectedVersion!, target, host.guard, host.signal);
            if (!snapshot || snapshot.file !== file || snapshot.path !== path) fail("stale_target", "The expected version does not identify this object.");
            before = snapshot!.before;
            if (await readText(host, file) !== before || !live(host, file, path)) fail("stale_target", "The saved text changed after reading.");
            after = args.text!; resource = { action, file, before, text: after };
        } else if (action === "move") {
            const to = args.to!; host.assertAllowed(to, true);
            if (to.startsWith(`${path}/`)) fail("path_rejected", "A folder cannot be moved into its own descendant.");
            if (to !== path && host.vault.getAbstractFileByPath(to)) fail("target_collision", "The destination already exists.");
            assertParent(host, to);
            // Native move owns paths, so neither its admission nor Undo requires unchanged bytes.
            const entries = await tree(host, file, false);
            for (const entry of entries) host.assertAllowed(to + entry.path.slice(path.length), true);
            resource = { action, file, to, tree: entries,
                ...("resourceRef" in resolved! ? { resourceRef: resolved.resourceRef } : {}) };
        } else if (action === "trash") {
            if (isFolder(file) && (file.children as unknown[]).length && !args.recursive) fail("schema_invalid", "A nonempty folder requires recursive:true.");
            if (!host.trashResource) fail("undo_unavailable", "Safe native resource trash is unavailable.");
            // Admit the whole tree before deciding whether its byte backup fits.
            resource = { action, tree: await tree(host, file, false) };
        } else {
            if (isFolder(file) || !context) fail("target_missing", "Only live files can be opened.");
            resource = { action: "open", context: context!, target, ...(args.position ? { position: args.position } : {}) };
        }
    }
    host.assertAllowed(path, action === "create" || action === "mkdir" || action === "undo");
    return Object.freeze({ kind: "resource", id: host.createId(), toolCallId: input.toolCallId, name: input.name,
        input: args, path, expectedBefore: before, expectedAfter: after, resource });
}
export async function prepareResourceRecovery(host: ResourceEffectHost, operation: PreparedResourceOperation): Promise<ResourceRecovery | undefined> {
    if (operation.resource.action !== "trash") return undefined;
    const original = operation.resource.tree;
    const required = treeBytes(original);
    if (host.recoveryOwner.usedBytes() + required > MAX_RESOURCE_RECOVERY_BYTES) return { kind: "capacity_exceeded" };
    const reservation = host.recoveryOwner.reserve(required, () => host.createId());
    try {
        const snapshots: ResourceTreeEntry[] = [];
        for (const entry of original) {
            host.assertAllowed(entry.path);
            if (!live(host, entry.file, entry.path) || entry.kind === "file" && entry.file.stat?.size !== entry.stat?.size) {
                fail("stale_target", "The original resource changed before recovery capture.");
            }
            const data = entry.kind === "file" ? await bytes(host, entry.file) : undefined;
            if (data && data.byteLength !== entry.stat?.size) fail("stale_target", "The resource changed while recovery was being captured.");
            snapshots.push({ ...entry, ...(data ? { bytes: data, contentHash: await hash(data) } : {}) });
        }
        await assertTree(host, snapshots);
        return { kind: "snapshot", tree: snapshots, reservation };
    } catch (error) { reservation.release(); throw error; }
}
export async function executeResourceOperation(host: ResourceEffectHost, intent: OperationsIntent,
    operation: PreparedResourceOperation, recovery?: ResourceRecovery): Promise<OperationExecutionResult> {
    const p = operation.resource;
    const base = { operationId: operation.id, toolCallId: operation.toolCallId, name: operation.name,
        path: p.action === "editor" ? p.binding.path : operation.path,
        ...(p.action === "move" ? { targetPath: p.to } : {}) };
    let attempted = false; let transferred = false; const created: string[] = [];
    let settledText: { receiptId?: string; resourceEffect: ResourceEffectFacts } | undefined;
    const createdFolders: Array<{ path: string; file: OperationsVaultFile }> = [];
    const receipt = (resource: UndoReceipt["resource"], before: string | null, after: string, path = operation.path) => host.isActive()
        ? host.undoStore.create({ intentId: intent.id, operationId: operation.id, path, kind: operation.name,
            before, expectedAfter: after, resource }).id : undefined;
    try {
        host.assertAllowed(base.path, p.action === "create" || p.action === "mkdir" || p.action === "undo");
        if (p.action === "create") {
            if (host.vault.getAbstractFileByPath(operation.path)) fail("target_collision", "The creation target now exists.");
            assertParent(host, operation.path, p.parent);
            attempted = true; host.markSelfWrite?.(operation.path);
            const file = await host.vault.create(operation.path, p.text);
            const receiptId = receipt({ action: "create", file }, null, p.text);
            settledText = { receiptId, resourceEffect: { kind: "create", paths: [operation.path] } };
            if (!live(host, file, operation.path) || await readText(host, file, true) !== p.text
                || !live(host, file, operation.path)) fail("unknown", "Creation completed but its current saved result cannot be verified.");
            host.assertAllowed(operation.path, true);
            p.context?.registerCreatedResource?.(file, p.text, receiptId);
            const bound = await p.context?.resolveTarget({ path: operation.path }, host.guard, host.signal);
            host.assertAllowed(operation.path, true);
            const resourceRef = bound?.file === file && bound.path === operation.path ? bound.resourceRef : undefined;
            return { ...base, status: "succeeded", receiptId, undoAvailable: !!receiptId,
                resourceEffect: { ...settledText.resourceEffect, ...(resourceRef ? { resourceRef } : {}) } };
        }
        if (p.action === "replace") {
            if (!live(host, p.file, operation.path)) fail("stale_target", "The original file object was replaced.");
            if (p.before === p.text) return { ...base, status: "unchanged", undoAvailable: false };
            await host.vault.process(p.file, current => {
                host.assertAllowed(operation.path);
                if (!live(host, p.file, operation.path) || current !== p.before) fail("stale_target", "Saved text changed before the write.");
                attempted = true; host.markSelfWrite?.(operation.path); return p.text;
            });
            const receiptId = receipt({ action: "replace", file: p.file }, p.before, p.text);
            settledText = { receiptId, resourceEffect: { kind: "replace", paths: [operation.path] } };
            if (!live(host, p.file, operation.path) || await readText(host, p.file) !== p.text) fail("unknown", "The current saved replacement cannot be verified.");
            return { ...base, status: "succeeded", receiptId, undoAvailable: !!receiptId, resourceEffect: settledText.resourceEffect };
        }
        if (p.action === "mkdir") {
            if (!p.paths.length) return { ...base, status: "unchanged", undoAvailable: false, resourceEffect: { kind: "mkdir", paths: [] } };
            if (!host.vault.createFolder) fail("fs_error", "Native folder creation is unavailable.");
            for (const parent of p.parents) if (!live(host, parent.file, parent.path)) fail("stale_target", "An existing parent folder changed.");
            for (const path of p.paths) {
                host.assertAllowed(path, true);
                if (host.vault.getAbstractFileByPath(path)) fail("target_collision", "A requested folder path became occupied.");
                assertParent(host, path); attempted = true;
                const folder = await host.vault.createFolder!(path);
                if (!live(host, folder, path) || !isFolder(folder)) fail("unknown", "The created folder cannot be verified.");
                created.push(path);
                createdFolders.push({ path, file: folder });
            }
            const receiptId = host.removeEmptyFolder
                ? receipt({ action: "mkdir", folders: createdFolders, removed: new Set() }, null, "") : undefined;
            for (const folder of createdFolders) p.context?.registerCreatedResource?.(folder.file, undefined, receiptId);
            return { ...base, status: "succeeded", receiptId, undoAvailable: !!receiptId,
                ...(!host.removeEmptyFolder ? { message: "Folders were created. Safe Undo for these folders is unavailable." } : {}),
                resourceEffect: { kind: "mkdir", paths: created } };
        }
        if (p.action === "move") {
            if (p.to === operation.path) return { ...base, status: "unchanged", undoAvailable: false,
                resourceEffect: { kind: "move", fromPath: operation.path, toPath: p.to,
                    ...(p.resourceRef ? { resourceRef: p.resourceRef } : {}) } };
            await assertTree(host, p.tree); host.assertAllowed(p.to, true);
            for (const entry of p.tree) host.assertAllowed(p.to + entry.path.slice(operation.path.length), true);
            if (host.vault.getAbstractFileByPath(p.to)) fail("target_collision", "The move destination became occupied.");
            assertParent(host, p.to);
            if (!host.renameFile) fail("fs_error", "Native rename is unavailable.");
            attempted = true; host.markSelfWrite?.(operation.path); host.markSelfWrite?.(p.to);
            try { await host.renameFile!(p.file, p.to); }
            catch (error) { if (!live(host, p.file, p.to)) throw error; }
            if (!live(host, p.file, p.to) || host.vault.getAbstractFileByPath(operation.path)) fail("unknown", "Native move completion cannot be verified.");
            const after = await tree(host, p.file, false);
            const receiptId = receipt({ action: "move", file: p.file, originalPath: operation.path, tree: after }, null, "", p.to);
            return { ...base, status: "succeeded", receiptId, undoAvailable: !!receiptId,
                resourceEffect: { kind: "move", paths: after.map(e => e.path), fromPath: operation.path, toPath: p.to,
                    ...(p.resourceRef ? { resourceRef: p.resourceRef } : {}) } };
        }
        if (p.action === "trash") {
            if (!recovery || !host.trashResource) fail("undo_unavailable", "Safe native trash preparation is unavailable; nothing was trashed.");
            await assertTree(host, recovery.kind === "snapshot" ? recovery.tree : p.tree); host.assertAllowed(operation.path);
            attempted = true; host.markSelfWrite?.(operation.path);
            try { await host.trashResource!(p.tree[0].file); }
            catch (error) { if (p.tree.some(entry => host.vault.getAbstractFileByPath(entry.path))) throw error; }
            if (host.vault.getAbstractFileByPath(operation.path)) fail("unknown", "The resource's removal cannot be verified.");
            if (recovery.kind === "capacity_exceeded") return { ...base, status: "succeeded", undoAvailable: false,
                message: "The resource was trashed. PA Undo is unavailable because its backup exceeds the available session capacity.",
                resourceEffect: { kind: "trash", paths: p.tree.map(e => e.path), undoUnavailableReason: "recovery_capacity" } };
            const retained = recovery;
            const receiptId = receipt({ action: "trash", tree: retained.tree, restored: new Map(), release: () => retained.reservation.release() }, null, "");
            transferred = !!receiptId;
            return { ...base, status: "succeeded", receiptId, undoAvailable: !!receiptId, resourceEffect: { kind: "trash", paths: p.tree.map(e => e.path) } };
        }
        if (p.action === "editor") {
            if (!p.binding.isLive() || p.binding.readBuffer() !== p.before) fail("stale_target", "The original editor changed before the transaction.");
            if (p.after === p.before) return { ...base, status: "unchanged", undoAvailable: false };
            host.assertAllowed(p.binding.path);
            attempted = true; p.binding.transact(p.edits);
            const actualAfter = p.binding.readBuffer();
            if (!p.binding.isLive() || actualAfter !== p.after) fail("unknown", "The actual editor transaction result cannot be verified.");
            const receiptId = receipt({ action: "editor", binding: p.binding }, p.before, actualAfter, p.binding.path);
            return { ...base, status: "succeeded", receiptId, undoAvailable: !!receiptId, resourceEffect: { kind: "editor", scope: "editor-buffer", saved: "unknown" } };
        }
        if (p.action === "open") {
            attempted = true;
            const opened = await p.context.openResource(p.target, p.position, host.guard, host.signal);
            const value = opened.value as { opened?: boolean; viewId?: string; viewType?: string;
                position?: import("./types").ResourceEffectFacts["position"] } | undefined;
            const unknown = !opened.ok && !value?.opened && opened.error.executionState === "acceptance_unknown";
            return { ...base, status: opened.ok ? "succeeded" : value?.opened ? "partial" : unknown ? "unknown" : "failed", undoAvailable: false,
                ...(opened.ok ? {} : { failureCategory: unknown ? "unknown" as const : "fs_error" as const, message: opened.error.message }),
                resourceEffect: { kind: "open", ...(!unknown ? { opened: value?.opened === true } : {}), viewId: value?.viewId, viewType: value?.viewType,
                    ...(value?.position ? { position: value.position } : {}) } };
        }
        if (!host.undo) fail("undo_unavailable", "Guarded session Undo is unavailable.");
        attempted = true; const undone = await host.undo!(p.receiptId);
        return { ...base, path: undone.path ?? base.path,
            status: undone.status === "undone" ? "succeeded" : undone.status === "stale" ? "stale" : undone.status === "unknown" ? "unknown" : "failed",
            message: undone.message, failureCategory: undone.failureCategory, undoAvailable: false, resourceEffect: { kind: "undo", undoStatus: undone.status } };
    } catch (error) {
        const category = error instanceof OperationsResourceError ? error.category : "fs_error";
        // A fulfilled native create/process is an owned effect even if later
        // verification loses admission. Keep its receipt without another read.
        if (settledText) return { ...base, status: "partial", failureCategory: category,
            message: error instanceof Error ? error.message : String(error), receiptId: settledText.receiptId,
            undoAvailable: !!settledText.receiptId && host.isActive(), resourceEffect: settledText.resourceEffect };
        let uncertainReceipt: string | undefined;
        if (createdFolders.length && host.removeEmptyFolder)
            uncertainReceipt = receipt({ action: "mkdir", folders: createdFolders, removed: new Set() }, null, "");
        if (p.action === "trash" && attempted && recovery?.kind === "snapshot") {
            const retained = recovery;
            const remaining = new Map<string, OperationsVaultFile>();
            for (const entry of retained.tree) if (host.vault.getAbstractFileByPath(entry.path) === entry.file) remaining.set(entry.path, entry.file);
            uncertainReceipt = receipt({ action: "trash", tree: retained.tree, restored: remaining,
                release: () => retained.reservation.release() }, null, "");
            transferred = !!uncertainReceipt;
        }
        const message = error instanceof Error ? error.message : String(error);
        return { ...base, status: created.length ? "partial" : attempted ? "unknown" : category === "stale_target" ? "stale" : "failed",
            failureCategory: attempted && !created.length ? "unknown" : category,
            message: created.length && !host.removeEmptyFolder
                ? `${message} Safe Undo for the created folders is unavailable.` : message,
            receiptId: uncertainReceipt, undoAvailable: !!uncertainReceipt,
            ...(created.length ? { resourceEffect: { kind: "mkdir" as const, paths: created } } : {}) };
    } finally { if (!transferred && recovery?.kind === "snapshot") recovery.reservation.release(); }
}
export async function undoResourceOperation(host: ResourceEffectHost, receipt: UndoReceipt): Promise<UndoResult> {
    const resource = receipt.resource!;
    const base = { receiptId: receipt.id, operationId: receipt.operationId,
        path: resource.action === "editor" ? resource.binding.path : receipt.path };
    let attempted = false;
    try {
        host.assertAllowed(base.path, resource.action === "trash");
        if (resource.action === "create" || resource.action === "replace") {
            if (!live(host, resource.file, receipt.path) || await readText(host, resource.file) !== receipt.expectedAfter) fail("stale_target", "The original file or expected text changed; Undo was not applied.");
            if (resource.action === "create") {
                if (!host.trashResource) fail("undo_unavailable", "Safe native trash is unavailable.");
                host.assertAllowed(receipt.path);
                if (!live(host, resource.file, receipt.path)) fail("stale_target", "The original created file changed during Undo verification.");
                attempted = true; await host.trashResource!(resource.file);
                if (host.vault.getAbstractFileByPath(receipt.path)) fail("unknown", "The created file's removal cannot be verified.");
            } else {
                await host.vault.process(resource.file, current => {
                    host.assertAllowed(receipt.path);
                    if (!live(host, resource.file, receipt.path) || current !== receipt.expectedAfter) fail("stale_target", "The original file changed before Undo.");
                    attempted = true; return receipt.before!;
                });
            }
        } else if (resource.action === "mkdir") {
            const ours = new Set(resource.folders.map(folder => folder.file));
            for (const folder of resource.folders) {
                if (resource.removed.has(folder.path)) continue;
                host.assertAllowed(folder.path);
                if (!live(host, folder.file, folder.path) || !isFolder(folder.file)
                    || (folder.file.children as OperationsVaultFile[]).some(child => !ours.has(child))) fail("stale_target", "A created folder changed or contains foreign content.");
            }
            if (!host.removeEmptyFolder) fail("undo_unavailable", "The public nonrecursive empty-folder deletion API is unavailable.");
            for (const folder of [...resource.folders].reverse()) {
                if (resource.removed.has(folder.path)) continue;
                host.assertAllowed(folder.path);
                if (!live(host, folder.file, folder.path) || (folder.file.children as unknown[]).length) fail("stale_target", "The created folder is no longer empty.");
                attempted = true;
                try { await host.removeEmptyFolder!(folder.file); }
                catch (error) {
                    if (live(host, folder.file, folder.path)) return { ...base, status: "unavailable", failureCategory: "undo_unavailable",
                        message: error instanceof Error ? error.message : String(error), undoAvailable: true };
                    if (host.vault.getAbstractFileByPath(folder.path)) throw error;
                }
                if (host.vault.getAbstractFileByPath(folder.path)) fail("unknown", "The empty-folder removal result cannot be verified.");
                resource.removed.add(folder.path);
            }
        } else if (resource.action === "editor") {
            if (!resource.binding.isLive() || resource.binding.readBuffer() !== receipt.expectedAfter) fail("stale_target", "The original editor changed; its current buffer was preserved.");
            host.assertAllowed(resource.binding.path);
            attempted = true; resource.binding.transact([{ from: 0, to: receipt.expectedAfter.length, text: receipt.before! }]);
            if (resource.binding.readBuffer() !== receipt.before) fail("unknown", "The editor Undo result cannot be verified.");
        } else if (resource.action === "move") {
            await assertTree(host, resource.tree); host.assertAllowed(resource.originalPath, true);
            for (const entry of resource.tree) host.assertAllowed(resource.originalPath + entry.path.slice(receipt.path.length), true);
            if (host.vault.getAbstractFileByPath(resource.originalPath)) fail("target_collision", "The original path is now occupied.");
            assertParent(host, resource.originalPath);
            if (!host.renameFile) fail("undo_unavailable", "Native rename is unavailable.");
            attempted = true; await host.renameFile!(resource.file, resource.originalPath);
            if (!live(host, resource.file, resource.originalPath)) fail("unknown", "The reverse move result cannot be verified.");
        } else {
            // Check every destination before the first restore. Prior completed
            // steps retain their objects and any subsequent user edits or new
            // children. A retry only fills destinations that are still missing.
            for (const entry of resource.tree) {
                host.assertAllowed(entry.path, true);
                const occupant = host.vault.getAbstractFileByPath(entry.path);
                const restored = resource.restored.get(entry.path);
                if (occupant && occupant !== restored || restored && occupant !== restored) fail("target_collision", "A restore destination is occupied by another object.");
            }
            for (const entry of resource.tree) {
                if (resource.restored.has(entry.path)) continue;
                host.assertAllowed(entry.path, true);
                if (host.vault.getAbstractFileByPath(entry.path)) fail("target_collision", "A restore destination became occupied.");
                assertParent(host, entry.path, resource.restored.get(parentVaultPath(entry.path)));
                let file: OperationsVaultFile;
                attempted = true;
                if (entry.kind === "folder") {
                    if (!host.vault.createFolder) fail("undo_unavailable", "Native folder restoration is unavailable.");
                    file = await host.vault.createFolder(entry.path);
                } else {
                    if (!host.vault.createBinary || !entry.bytes) fail("undo_unavailable", "Exact byte restoration is unavailable.");
                    file = await host.vault.createBinary(entry.path, entry.bytes, entry.stat ? { ctime: entry.stat.ctime, mtime: entry.stat.mtime } : undefined);
                }
                resource.restored.set(entry.path, file);
                if (!live(host, file, entry.path)) fail("unknown", "The restored object cannot be verified.");
                if (entry.kind === "file" && await hash(await bytes(host, file)) !== entry.contentHash) fail("unknown", "The restored bytes cannot be verified.");
            }
        }
        return { ...base, status: "undone", undoAvailable: false };
    } catch (error) {
        const category = error instanceof OperationsResourceError ? error.category : "fs_error";
        return { ...base, status: attempted ? "unknown" : category === "stale_target" || category === "target_collision" ? "stale" : category === "undo_unavailable" ? "unavailable" : "failed",
            failureCategory: attempted ? "unknown" : category, message: error instanceof Error ? error.message : String(error),
            undoAvailable: (resource.action === "trash" || resource.action === "mkdir") && host.isActive() };
    }
}
