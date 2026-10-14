import { webcrypto } from "node:crypto";
import { OperationsService } from "../src/ai-services/operations/operations-service";
import { createOperationsStagingToolExecutor } from "../src/ai-services/operations/operations-tool-executor";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { completeInputLineage } from "../src/ai-services/input-lineage";
import { TaskSourceRun } from "../src/ai-services/task-source-run";
import { TaskSourceResourceIdentities } from "../src/ai-services/task-source-resource-identities";
import { resolveObsidianResource } from "../src/ai-services/independent-computation/obsidian-resource-sdk";
import { operationsResultObservation, isOperationsResultObservation } from "../src/ai-services/operations-status-tool";
import type { OperationsVault, OperationsVaultFile, ResourceOperationToolName, OperationsResourceContext } from "../src/ai-services/operations/types";
import type { SdkResource, ReadSnapshotBinding } from "../src/ai-services/independent-computation/obsidian-resource-sdk";
import type { TaskSourceReadGuard } from "../src/ai-services/task-source-read-guard";

interface File extends OperationsVaultFile { children?: File[] }
class Vault implements OperationsVault {
    readonly objects = new Map<string, File>();
    readonly data = new Map<File, Uint8Array>();
    onRead?: (file: File) => void;
    failRestorePath?: string;
    readonly adapter = { exists: async (path: string) => this.objects.has(path) };
    constructor() { this.folder(""); this.folder("assets"); this.folder("archive"); }
    folder(path: string): File {
        const file: File = { path, children: [] }; this.attach(file); return file;
    }
    file(path: string, data: string | Uint8Array): File {
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        const file: File = { path, stat: { ctime: 10, mtime: 20, size: bytes.length } };
        this.data.set(file, bytes.slice()); this.attach(file); return file;
    }
    private attach(file: File): void {
        this.objects.set(file.path, file);
        const parent = this.objects.get(file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "");
        if (parent !== file) parent?.children?.push(file);
    }
    remove(file: File): void {
        const parent = this.objects.get(file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "");
        if (parent?.children) parent.children = parent.children.filter(child => child !== file);
        const all = [...this.objects.values()].filter(candidate => candidate === file || candidate.path.startsWith(`${file.path}/`));
        for (const candidate of all) { this.objects.delete(candidate.path); this.data.delete(candidate); }
    }
    getAbstractFileByPath(path: string): File | null { return this.objects.get(path) ?? null; }
    read = jest.fn(async (file: OperationsVaultFile) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(this.data.get(file as File)));
    readBinary = jest.fn(async (file: OperationsVaultFile) => {
        const value = this.data.get(file as File)!.slice(); this.onRead?.(file as File); return value.buffer;
    });
    create = jest.fn(async (path: string, text: string) => this.file(path, text));
    createFolder = jest.fn(async (path: string) => this.folder(path));
    createBinary = jest.fn(async (path: string, bytes: ArrayBuffer, options?: { ctime?: number; mtime?: number }) => {
        if (this.failRestorePath === path) throw new Error("Injected native restore failure");
        const file = this.file(path, new Uint8Array(bytes));
        file.stat = { ...file.stat!, ...options }; return file;
    });
    process = jest.fn(async (file: OperationsVaultFile, transform: (text: string) => string) => {
        const changed = transform(await this.read(file)); this.data.set(file as File, new TextEncoder().encode(changed));
        file.stat = { ...file.stat!, size: new TextEncoder().encode(changed).length }; return changed;
    });
    rename = jest.fn(async (file: OperationsVaultFile, to: string) => {
        const source = file.path;
        const parent = this.objects.get(source.includes("/") ? source.slice(0, source.lastIndexOf("/")) : "");
        if (parent?.children) parent.children = parent.children.filter(child => child !== file);
        const members = [...this.objects.values()].filter(candidate => candidate === file || candidate.path.startsWith(`${source}/`));
        for (const item of members) this.objects.delete(item.path);
        for (const item of members) { item.path = to + item.path.slice(source.length); this.objects.set(item.path, item); }
        this.objects.get(to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "")?.children?.push(file as File);
    });
    trash = jest.fn(async (file: OperationsVaultFile) => this.remove(file as File));
    removeEmpty = jest.fn(async (file: OperationsVaultFile) => {
        if ((file.children as unknown[]).length) throw new Error("ENOTEMPTY"); this.remove(file as File);
    });
}

async function fixture(options: { emptyFolderUndo?: boolean } = {}) {
    const vault = new Vault(); const blocked = new Set<string>(); let active = true;
    const guard: TaskSourceReadGuard = {
        isCurrent: () => active, isNoteDomainAllowed: () => active,
        isPathAllowed: path => active && !blocked.has(path) && /^(assets|archive)(\/|$)/.test(path),
        captureSourceAuthority: () => () => active,
    };
    const versions = new Map<string, ReadSnapshotBinding>();
    const workspace = { getActiveViewOfType: () => null, iterateAllLeaves: () => undefined };
    const sourceRun = new TaskSourceRun({ runId: "run", userMessageId: "resource-user", userText: "request",
        workspace: workspace as never, getFileByPath: path => vault.objects.get(path), isCurrent: () => active,
        isPathAllowed: path => !blocked.has(path) && /^(assets|archive)(\/|$)/.test(path),
        resourceIdentities: new TaskSourceResourceIdentities({ runId: "run", getAbstractFileByPath: path => vault.objects.get(path) }) });
    const sdkHost = { host: { app: { vault, workspace } } as never, sourceRun };
    const context: OperationsResourceContext = {
        resolveTarget: (target, supplied, signal) => {
            expect(supplied).toBe(guard);
            return resolveObsidianResource({ ...sdkHost, guard: supplied, signal }, target);
        },
        getReadSnapshot: version => versions.get(version),
        resolveWorkspaceSnapshot: () => undefined,
        openResource: async () => ({ ok: false, error: { code: "unavailable", message: "not used" } }),
    };
    const legacyTrash = jest.fn(async () => undefined);
    const service = new OperationsService({ vault, trashFile: legacyTrash, trashResource: vault.trash,
        renameFile: vault.rename, ...(options.emptyFolderUndo === false ? {} : { removeEmptyFolder: vault.removeEmpty }),
        isOperationsAgentEnabled: () => active, isPathAllowed: path => !blocked.has(path) });
    const session = service.createSession({ surface: "resources" });
    let sequence = 0;
    const stage = (name: ResourceOperationToolName, input: unknown, mode: "apply" | "preview" = "apply") => session.stageIntent({
        runId: "run", turnId: `turn-${++sequence}`, mode, resourceContext: context, taskSourceReadGuard: guard,
        operations: [{ toolCallId: `call-${sequence}`, name, input }],
    });
    const apply = async (name: ResourceOperationToolName, input: unknown) => {
        const intent = await stage(name, input);
        return session.executeCurrentIntent({ intentId: intent.id, runId: "run", taskSourceReadGuard: guard });
    };
    const version = async (file: File) => {
        const key = `version-${versions.size}`;
        versions.set(key, { file: file as SdkResource, path: file.path, resourceRef: sourceRun.resolveResourceIdentity({ path: file.path })!.resourceRef, kind: "file",
            sourceVersion: key, readRef: key, before: await vault.read(file) }); return key;
    };
    return { vault, service, session, guard, context, sourceRun, sdkHost, blocked, legacyTrash, stage, apply, version, stop: () => { active = false; } };
}
beforeAll(() => Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto }));

describe("Operations Resource SDK", () => {
    it("keeps a ZWNJ filename intact through creation, reference-based move and trash", async () => {
        const h = await fixture();
        try {
            const path = "assets/یادداشت‌ها.md";
            const created = await h.apply("obsidian.vault.createText", { path, text: "Original" });
            expect(created.operations[0].status).toBe("succeeded");
            const file = h.vault.objects.get(path)!;
            const target = { resourceRef: h.sourceRun.resolveResourceIdentity({ path })!.resourceRef };
            const moved = await h.apply("obsidian.vault.move", { source: target, to: "archive/یادداشت‌ها.md" });
            expect(moved.operations[0].status).toBe("succeeded");
            expect(h.vault.objects.get("archive/یادداشت‌ها.md")).toBe(file);
            const trashed = await h.apply("obsidian.vault.trash", { target });
            expect(trashed.operations[0].status).toBe("succeeded");
            expect(h.vault.objects.has("archive/یادداشت‌ها.md")).toBe(false);
            expect((await h.session.undoMany([trashed.operations[0].receiptId!]))[0].status).toBe("undone");
            expect(await h.vault.read(h.vault.objects.get("archive/یادداشت‌ها.md")!)).toBe("Original");
        } finally { h.service.dispose(); }
    });
    it("creates ordinary text, preserves BOM/CRLF and refuses Undo after a later edit", async () => {
        const h = await fixture();
        try {
            const result = await h.apply("obsidian.vault.createText", { path: "assets/data.bases", text: "\ufeffa\r\n" });
            const op = result.operations[0]; expect(op).toMatchObject({ status: "succeeded", undoAvailable: true });
            const file = h.vault.objects.get(op.path)!;
            const observation = operationsResultObservation(result);
            expect(isOperationsResultObservation(observation)).toBe(true);
            expect(observation.operations[0].resourceEffect?.resourceRef).toBe(h.sourceRun.resolveResourceIdentity({ path: op.path })!.resourceRef);
            expect(await h.vault.read(file)).toBe("\ufeffa\r\n");
            h.vault.data.set(file, new TextEncoder().encode("user edit"));
            expect((await h.session.undoMany([op.receiptId!]))[0].status).toBe("stale");
            expect(await h.vault.read(file)).toBe("user edit"); expect(h.vault.trash).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("rejects a read version from a rebuilt object with the same path and bytes", async () => {
        const h = await fixture();
        try {
            const original = h.vault.file("assets/data.txt", "same"); const version = await h.version(original);
            h.vault.remove(original); h.vault.file("assets/data.txt", "same");
            await expect(h.stage("obsidian.vault.replaceText", { target: { path: "assets/data.txt" }, expectedVersion: version, text: "changed" })).rejects.toMatchObject({ category: "stale_target" });
            expect(h.vault.process).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("preserves a same-path replacement appearing during create Undo verification", async () => {
        const h = await fixture();
        try {
            const result = await h.apply("obsidian.vault.createText", { path: "assets/new.txt", text: "created" });
            const original = h.vault.objects.get("assets/new.txt")!;
            let replacement: File | undefined;
            h.vault.onRead = () => {
                h.vault.onRead = undefined; h.vault.remove(original); replacement = h.vault.file("assets/new.txt", "foreign");
            };
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("stale");
            expect(h.vault.trash).not.toHaveBeenCalled();
            expect(h.vault.objects.get("assets/new.txt")).toBe(replacement);
            expect(await h.vault.read(replacement!)).toBe("foreign");
        } finally { h.service.dispose(); }
    });
    it("checks replacement atomically and gives exact BOM Undo for an unchanged result", async () => {
        const h = await fixture();
        try {
            const file = h.vault.file("assets/data.txt", "\ufeffa\r\n"); const version = await h.version(file);
            const result = await h.apply("obsidian.vault.replaceText", { target: { path: file.path }, expectedVersion: version, text: "\ufeffb\r\n" });
            expect(result.operations[0].status).toBe("succeeded");
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("undone");
            expect(await h.vault.read(file)).toBe("\ufeffa\r\n");
            const next = await h.stage("obsidian.vault.replaceText", { target: { path: file.path }, expectedVersion: version, text: "C" });
            h.vault.data.set(file, new TextEncoder().encode("changed after prepare"));
            const stale = await h.session.executeCurrentIntent({ intentId: next.id, runId: "run", taskSourceReadGuard: h.guard });
            expect(stale.operations[0].status).toBe("stale"); expect(await h.vault.read(file)).toBe("changed after prepare");
        } finally { h.service.dispose(); }
    });
    it("replaces already-read text larger than the trash backup budget and restores it exactly", async () => {
        const h = await fixture();
        try {
            const before = "x".repeat(9 * 1024 * 1024);
            const file = h.vault.file("assets/large.txt", before); const version = await h.version(file);
            const result = await h.apply("obsidian.vault.replaceText", { target: { path: file.path }, expectedVersion: version, text: "short" });
            expect(result.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: true });
            expect(await h.vault.read(file)).toBe("short");
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("undone");
            expect(await h.vault.read(file)).toBe(before);
        } finally { h.service.dispose(); }
    });
    it.each(["create", "replace"] as const)("retains the settled %s and receipt when post-write source access is revoked", async action => {
        const h = await fixture();
        try {
            let result;
            let beforeReads: number;
            if (action === "create") {
                h.vault.create.mockImplementationOnce(async (path, text) => {
                    const file = h.vault.file(path, text); h.blocked.add(path); return file;
                });
                beforeReads = 0;
                result = await h.apply("obsidian.vault.createText", { path: "assets/new.txt", text: "settled" });
            } else {
                const file = h.vault.file("assets/new.txt", "before"); const version = await h.version(file);
                const intent = await h.stage("obsidian.vault.replaceText", { target: { path: file.path }, expectedVersion: version, text: "settled" });
                beforeReads = h.vault.readBinary.mock.calls.length;
                const process = h.vault.process.getMockImplementation()!;
                h.vault.process.mockImplementationOnce(async (target, transform) => {
                    const text = await process(target, transform); h.blocked.add(target.path); return text;
                });
                result = await h.session.executeCurrentIntent({ intentId: intent.id, runId: "run", taskSourceReadGuard: h.guard });
            }
            expect(result).toMatchObject({ state: "partial", operations: [{ status: "partial", failureCategory: "boundary_denied",
                receiptId: expect.any(String), resourceEffect: { kind: action, paths: ["assets/new.txt"] } }] });
            expect(h.vault.readBinary).toHaveBeenCalledTimes(beforeReads);
            expect(h.vault.create).toHaveBeenCalledTimes(action === "create" ? 1 : 0);
            expect(h.vault.process).toHaveBeenCalledTimes(action === "replace" ? 1 : 0);
            expect(new TextDecoder().decode(h.vault.data.get(h.vault.objects.get("assets/new.txt")!))).toBe("settled");
            h.blocked.clear();
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("undone");
        } finally { h.service.dispose(); }
    });
    it("does not accept verification bytes returned after the resource was revoked during the read", async () => {
        const h = await fixture();
        try {
            h.vault.onRead = file => { h.vault.onRead = undefined; h.blocked.add(file.path); };
            const result = await h.apply("obsidian.vault.createText", { path: "assets/new.txt", text: "settled" });
            expect(result).toMatchObject({ state: "partial", operations: [{ status: "partial", failureCategory: "boundary_denied", receiptId: expect.any(String) }] });
            expect(h.vault.readBinary).toHaveBeenCalledTimes(1); expect(h.vault.create).toHaveBeenCalledTimes(1);
            expect(result.operations[0].resourceEffect?.resourceRef).toBeUndefined();
        } finally { h.service.dispose(); }
    });
    it("previews folders with zero effects and reverses only the folders actually created", async () => {
        const h = await fixture();
        try {
            const preview = await h.stage("obsidian.vault.mkdir", { path: "assets/new/deep", parents: true }, "preview");
            expect(h.vault.createFolder).not.toHaveBeenCalled();
            await expect(h.session.executeCurrentIntent({ intentId: preview.id, runId: "run", taskSourceReadGuard: h.guard })).rejects.toMatchObject({ category: "boundary_denied" });
            const result = await h.apply("obsidian.vault.mkdir", { path: "assets/new/deep", parents: true });
            expect(result.operations[0].resourceEffect?.paths).toEqual(["assets/new", "assets/new/deep"]);
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("undone");
            expect(h.vault.objects.has("assets")).toBe(true); expect(h.vault.objects.has("assets/new")).toBe(false);
        } finally { h.service.dispose(); }
    });
    it("keeps mkdir and preview available without promising a receipt when safe folder Undo is unavailable", async () => {
        const h = await fixture({ emptyFolderUndo: false });
        try {
            const preview = await h.stage("obsidian.vault.mkdir", { path: "assets/new/deep", parents: true }, "preview");
            expect(h.vault.createFolder).not.toHaveBeenCalled();
            await expect(h.session.executeCurrentIntent({ intentId: preview.id, runId: "run", taskSourceReadGuard: h.guard }))
                .rejects.toMatchObject({ category: "boundary_denied" });
            const result = await h.apply("obsidian.vault.mkdir", { path: "assets/new/deep", parents: true });
            expect(result).toMatchObject({ state: "completed", operations: [{ status: "succeeded", undoAvailable: false,
                message: "Folders were created. Safe Undo for these folders is unavailable.",
                resourceEffect: { kind: "mkdir", paths: ["assets/new", "assets/new/deep"] } }] });
            expect(result.operations[0].receiptId).toBeUndefined();
            expect(operationsResultObservation(result).operations[0].receiptId).toBeUndefined();
            expect(h.vault.createFolder).toHaveBeenCalledTimes(2);
            expect(h.vault.objects.has("assets/new/deep")).toBe(true);
            expect(h.vault.removeEmpty).not.toHaveBeenCalled();
            expect(h.vault.trash).not.toHaveBeenCalled();
            expect(h.legacyTrash).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("preserves partial mkdir effects and the original failure without an unusable Undo receipt", async () => {
        const h = await fixture({ emptyFolderUndo: false });
        try {
            const createFolder = h.vault.createFolder.getMockImplementation()!;
            h.vault.createFolder.mockImplementationOnce(createFolder).mockRejectedValueOnce(new Error("Native folder creation failed."));
            const result = await h.apply("obsidian.vault.mkdir", { path: "assets/new/deep", parents: true });
            expect(result).toMatchObject({ state: "partial", operations: [{ status: "partial", undoAvailable: false,
                message: "Native folder creation failed. Safe Undo for the created folders is unavailable.",
                resourceEffect: { kind: "mkdir", paths: ["assets/new"] } }] });
            expect(result.operations[0].receiptId).toBeUndefined();
            expect(h.vault.createFolder).toHaveBeenCalledTimes(2);
            expect(h.vault.objects.has("assets/new")).toBe(true);
            expect(h.vault.objects.has("assets/new/deep")).toBe(false);
            expect(h.vault.removeEmpty).not.toHaveBeenCalled();
            expect(h.vault.trash).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("preserves new foreign folder content and reports native EISDIR without recursive fallback", async () => {
        const h = await fixture();
        try {
            const result = await h.apply("obsidian.vault.mkdir", { path: "assets/new" }); const id = result.operations[0].receiptId!;
            const userFile = h.vault.file("assets/new/user.txt", "user");
            expect((await h.session.undoMany([id]))[0].status).toBe("stale"); expect(h.vault.removeEmpty).not.toHaveBeenCalled();
            h.vault.remove(userFile);
            h.vault.removeEmpty.mockRejectedValueOnce(new Error("EISDIR"));
            expect((await h.session.undoMany([id]))[0]).toMatchObject({ status: "unavailable", failureCategory: "undo_unavailable" });
            expect(h.vault.objects.has("assets/new")).toBe(true); expect(h.vault.trash).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("moves a real directory, detects later additions and uses native reverse rename", async () => {
        const h = await fixture();
        try {
            const folder = h.vault.folder("assets/tree"); h.vault.file("assets/tree/data.bin", new Uint8Array([0, 255]));
            const originalRef = h.sourceRun.resolveResourceIdentity({ path: folder.path })!.resourceRef;
            const result = await h.apply("obsidian.vault.move", { source: { path: folder.path }, to: "archive/tree" });
            const observation = operationsResultObservation(result);
            expect(isOperationsResultObservation(observation)).toBe(true);
            expect(observation.operations[0].resourceEffect).toMatchObject({ fromPath: "assets/tree", toPath: "archive/tree", resourceRef: originalRef });
            expect(resolveObsidianResource({ ...h.sdkHost, guard: h.guard }, { resourceRef: originalRef })?.file).toBe(folder);
            expect(h.vault.objects.get("archive/tree")).toBe(folder); expect(h.vault.objects.has("assets/tree")).toBe(false);
            const extra = h.vault.file("archive/tree/user.txt", "user");
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("stale");
            h.vault.remove(extra);
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("undone");
            expect(h.vault.objects.get("assets/tree")).toBe(folder); expect(h.vault.rename).toHaveBeenCalledTimes(2);
        } finally { h.service.dispose(); }
    });
    it("moves a large file without reading its bytes and preserves later edits when undoing its path", async () => {
        const h = await fixture();
        try {
            // These operations use metadata only; any body read fails the assertions below.
            const file = h.vault.file("assets/large.pdf", new Uint8Array([0]));
            file.stat!.size = 9 * 1024 * 1024;
            const result = await h.apply("obsidian.vault.move", { source: { path: file.path }, to: "archive/large.pdf" });
            expect(result.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: true });
            h.vault.data.get(file)![0] = 42;
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("undone");
            expect(h.vault.objects.get("assets/large.pdf")).toBe(file);
            expect(h.vault.data.get(file)![0]).toBe(42);
            expect(h.vault.rename).toHaveBeenCalledTimes(2);
            expect(h.vault.readBinary).not.toHaveBeenCalled();

            const trash = await h.apply("obsidian.vault.trash", { target: { path: file.path } });
            expect(trash.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: false,
                message: expect.stringContaining("PA Undo is unavailable"), resourceEffect: { undoUnavailableReason: "recovery_capacity" } });
            expect(trash.operations[0].receiptId).toBeUndefined();
            const observation = operationsResultObservation(trash);
            expect(isOperationsResultObservation(observation)).toBe(true);
            expect(observation).toMatchObject({ undoAvailable: false,
                operations: [{ resourceEffect: { kind: "trash", undoUnavailableReason: "recovery_capacity" } }] });
            expect(h.vault.trash).toHaveBeenCalledWith(file);
            expect(h.vault.readBinary).not.toHaveBeenCalled();
            expect(h.legacyTrash).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("moves and reverses a tree larger than the recovery byte budget while keeping trash backups bounded", async () => {
        const h = await fixture();
        try {
            const folder = h.vault.folder("assets/large-tree");
            const files = Array.from({ length: 9 }, (_, index) => {
                const file = h.vault.file(`assets/large-tree/${index}.bin`, new Uint8Array([index]));
                file.stat!.size = 1024 * 1024;
                return file;
            });
            const originals = files.map(file => ({ file, path: file.path, bytes: h.vault.data.get(file)! }));
            const moved = await h.apply("obsidian.vault.move", { source: { path: folder.path }, to: "archive/large-tree" });
            expect(moved.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: true });
            expect(h.vault.objects.get("archive/large-tree")).toBe(folder);
            expect(h.vault.objects.has("assets/large-tree")).toBe(false);
            for (const original of originals) {
                expect(h.vault.objects.get(original.path.replace("assets/", "archive/"))).toBe(original.file);
                expect(h.vault.data.get(original.file)).toBe(original.bytes);
            }
            expect((await h.session.undoMany([moved.operations[0].receiptId!]))[0].status).toBe("undone");
            expect(h.vault.objects.get("assets/large-tree")).toBe(folder);
            expect(h.vault.objects.has("archive/large-tree")).toBe(false);
            for (const original of originals) {
                expect(h.vault.objects.get(original.path)).toBe(original.file);
                expect(h.vault.data.get(original.file)).toBe(original.bytes);
            }
            expect(h.vault.rename).toHaveBeenCalledTimes(2);
            expect(h.vault.createBinary).not.toHaveBeenCalled();

            const trash = await h.apply("obsidian.vault.trash", { target: { path: folder.path }, recursive: true });
            expect(trash.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: false });
            expect(trash.operations[0].receiptId).toBeUndefined();
            expect(h.vault.trash).toHaveBeenCalledWith(folder);
            expect(h.vault.objects.has("assets/large-tree")).toBe(false);
            expect(h.vault.readBinary).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("rechecks excluded descendants before native trash even when recovery capacity is insufficient", async () => {
        const h = await fixture();
        try {
            h.vault.folder("assets/tree");
            const file = h.vault.file("assets/tree/private.bin", new Uint8Array([0]));
            file.stat!.size = 9 * 1024 * 1024;
            const intent = await h.stage("obsidian.vault.trash", { target: { path: "assets/tree" }, recursive: true });
            h.blocked.add("assets/tree/private.bin");
            const result = await h.session.executeCurrentIntent({ intentId: intent.id, runId: "run", taskSourceReadGuard: h.guard });
            expect(result.operations[0]).toMatchObject({ status: "failed", failureCategory: "boundary_denied" });
            expect(h.vault.readBinary).not.toHaveBeenCalled(); expect(h.vault.trash).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("keeps a same-path replacement when capacity-limited trash loses the original object", async () => {
        const h = await fixture();
        try {
            const original = h.vault.file("assets/large.pdf", new Uint8Array([0]));
            original.stat!.size = 9 * 1024 * 1024;
            const intent = await h.stage("obsidian.vault.trash", { target: { path: original.path } });
            h.vault.remove(original); const foreign = h.vault.file(original.path, "foreign");
            const result = await h.session.executeCurrentIntent({ intentId: intent.id, runId: "run", taskSourceReadGuard: h.guard });
            expect(result.operations[0]).toMatchObject({ status: "stale", failureCategory: "stale_target" });
            expect(h.vault.objects.get(original.path)).toBe(foreign); expect(h.vault.trash).not.toHaveBeenCalled();
            expect(h.vault.readBinary).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("does not downgrade recovery read failures into native trash without Undo", async () => {
        const h = await fixture();
        try {
            const file = h.vault.file("assets/data.bin", new Uint8Array([1]));
            h.vault.readBinary.mockRejectedValueOnce(new Error("Injected recovery read failure"));
            const result = await h.apply("obsidian.vault.trash", { target: { path: file.path } });
            expect(result.operations[0]).toMatchObject({ status: "failed", failureCategory: "fs_error" });
            expect(h.vault.objects.get(file.path)).toBe(file); expect(h.vault.trash).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("uses safe native trash without another backup when earlier Undo occupies the session capacity", async () => {
        const h = await fixture();
        try {
            const first = h.vault.file("assets/first.bin", new Uint8Array(5 * 1024 * 1024));
            const second = h.vault.file("assets/second.bin", new Uint8Array(5 * 1024 * 1024));
            const retained = await h.apply("obsidian.vault.trash", { target: { path: first.path } });
            expect(retained.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: true });
            const reads = h.vault.readBinary.mock.calls.length;
            const unretained = await h.apply("obsidian.vault.trash", { target: { path: second.path } });
            expect(unretained.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: false,
                resourceEffect: { undoUnavailableReason: "recovery_capacity" } });
            expect(unretained.operations[0].receiptId).toBeUndefined();
            expect(h.vault.readBinary).toHaveBeenCalledTimes(reads);
            expect((await h.session.undoMany([retained.operations[0].receiptId!]))[0].status).toBe("undone");
            expect(h.vault.objects.has(second.path)).toBe(false);
        } finally { h.service.dispose(); }
    });
    it("checks every reverse directory destination before native Undo", async () => {
        const h = await fixture();
        try {
            const folder = h.vault.folder("assets/tree"); h.vault.file("assets/tree/data.bin", new Uint8Array([1]));
            const result = await h.apply("obsidian.vault.move", { source: { path: folder.path }, to: "archive/tree" });
            const receiptId = result.operations[0].receiptId!;
            expect(h.session.getUndoTargetPaths(receiptId)).toContain("assets/tree/data.bin");
            h.blocked.add("assets/tree/data.bin");
            expect((await h.session.undoMany([receiptId]))[0]).toMatchObject({ status: "failed", failureCategory: "boundary_denied" });
            expect(h.vault.objects.get("archive/tree")).toBe(folder); expect(h.vault.rename).toHaveBeenCalledTimes(1);
            h.blocked.clear();
            expect((await h.session.undoMany([receiptId]))[0].status).toBe("undone");
        } finally { h.service.dispose(); }
    });
    it("rechecks every prepared directory destination before native move", async () => {
        const h = await fixture();
        try {
            const folder = h.vault.folder("assets/tree"); h.vault.file("assets/tree/data.bin", new Uint8Array([1]));
            const intent = await h.stage("obsidian.vault.move", { source: { path: folder.path }, to: "archive/tree" });
            h.blocked.add("archive/tree/data.bin");
            const result = await h.session.executeCurrentIntent({ intentId: intent.id, runId: "run", taskSourceReadGuard: h.guard });
            expect(result.operations[0]).toMatchObject({ status: "failed", failureCategory: "boundary_denied" });
            expect(h.vault.rename).not.toHaveBeenCalled(); expect(h.vault.objects.get("assets/tree")).toBe(folder);
        } finally { h.service.dispose(); }
    });
    it("rejects a new descendant appearing during full recovery capture before any trash", async () => {
        const h = await fixture();
        try {
            h.vault.folder("assets/tree"); h.vault.file("assets/tree/data.bin", new Uint8Array([0, 255]));
            const intent = await h.stage("obsidian.vault.trash", { target: { path: "assets/tree" }, recursive: true });
            h.vault.onRead = () => { h.vault.onRead = undefined; h.vault.file("assets/tree/late.bin", new Uint8Array([2])); };
            const result = await h.session.executeCurrentIntent({ intentId: intent.id, runId: "run", taskSourceReadGuard: h.guard });
            expect(result.operations[0]).toMatchObject({ status: "failed", failureCategory: "stale_target" }); expect(h.vault.trash).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("restores captured binary bytes/times as new objects and preserves a conflicting foreign object", async () => {
        const h = await fixture();
        try {
            const old = h.vault.file("assets/data.bin", new Uint8Array([0, 255, 3]));
            const result = await h.apply("obsidian.vault.trash", { target: { path: old.path } }); const id = result.operations[0].receiptId!;
            expect(h.legacyTrash).not.toHaveBeenCalled();
            const foreign = h.vault.file("assets/data.bin", "foreign");
            expect((await h.session.undoMany([id]))[0].status).toBe("stale"); expect(h.vault.objects.get(foreign.path)).toBe(foreign);
            h.vault.remove(foreign);
            expect((await h.session.undoMany([id]))[0].status).toBe("undone");
            const restored = h.vault.objects.get(old.path)!; expect(restored).not.toBe(old);
            expect([...h.vault.data.get(restored)!]).toEqual([0, 255, 3]); expect(restored.stat).toEqual(old.stat);
        } finally { h.service.dispose(); }
    });
    it("continues partial restore without overwriting later edits or unrelated new content", async () => {
        const h = await fixture();
        try {
            h.vault.folder("assets/tree"); h.vault.file("assets/tree/a.bin", new Uint8Array([1])); h.vault.file("assets/tree/b.bin", new Uint8Array([2]));
            const result = await h.apply("obsidian.vault.trash", { target: { path: "assets/tree" }, recursive: true }); const id = result.operations[0].receiptId!;
            h.vault.failRestorePath = "assets/tree/b.bin";
            expect((await h.session.undoMany([id]))[0]).toMatchObject({ status: "unknown", undoAvailable: true });
            const first = h.vault.objects.get("assets/tree/a.bin")!; h.vault.failRestorePath = undefined;
            h.vault.data.set(first, new Uint8Array([9]));
            const added = h.vault.file("assets/tree/new.txt", "User content");
            const callsBeforeRetry = h.vault.createBinary.mock.calls.length;
            h.blocked.add("assets/tree/b.bin");
            expect((await h.session.undoMany([id]))[0]).toMatchObject({ status: "failed", failureCategory: "boundary_denied" });
            expect(h.vault.createBinary).toHaveBeenCalledTimes(callsBeforeRetry);
            h.blocked.clear();
            expect((await h.session.undoMany([id]))[0].status).toBe("undone");
            expect(h.vault.objects.get("assets/tree/a.bin")).toBe(first);
            expect([...h.vault.data.get(first)!]).toEqual([9]);
            expect(h.vault.objects.get(added.path)).toBe(added);
            expect(await h.vault.read(added)).toBe("User content");
            expect([...h.vault.data.get(h.vault.objects.get("assets/tree/b.bin")!)!]).toEqual([2]);
            expect(h.vault.createBinary.mock.calls.filter(([path]) => path === "assets/tree/a.bin")).toHaveLength(1);
        } finally { h.service.dispose(); }
    });
    it("does not continue a partial restore through a replaced restored object", async () => {
        const h = await fixture();
        try {
            h.vault.folder("assets/tree"); h.vault.file("assets/tree/a.bin", new Uint8Array([1])); h.vault.file("assets/tree/b.bin", new Uint8Array([2]));
            const result = await h.apply("obsidian.vault.trash", { target: { path: "assets/tree" }, recursive: true });
            const id = result.operations[0].receiptId!;
            h.vault.failRestorePath = "assets/tree/b.bin";
            expect((await h.session.undoMany([id]))[0].status).toBe("unknown");
            h.vault.failRestorePath = undefined;
            h.vault.remove(h.vault.objects.get("assets/tree/a.bin")!);
            const replacement = h.vault.file("assets/tree/a.bin", "Replacement");
            const callsBeforeRetry = h.vault.createBinary.mock.calls.length;
            expect((await h.session.undoMany([id]))[0]).toMatchObject({ status: "stale", failureCategory: "target_collision" });
            expect(h.vault.createBinary).toHaveBeenCalledTimes(callsBeforeRetry);
            expect(h.vault.objects.get(replacement.path)).toBe(replacement);
            expect(h.vault.objects.has("assets/tree/b.bin")).toBe(false);
        } finally { h.service.dispose(); }
    });
    it("keeps a proven removal and its original receipt when native trash rejects after removal", async () => {
        const h = await fixture();
        try {
            const file = h.vault.file("assets/data.bin", new Uint8Array([1]));
            h.vault.trash.mockImplementationOnce(async candidate => { h.vault.remove(candidate as File); throw new Error("late native failure"); });
            const result = await h.apply("obsidian.vault.trash", { target: { path: file.path } });
            expect(result.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: true });
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("undone"); expect(h.vault.trash).toHaveBeenCalledTimes(1);
        } finally { h.service.dispose(); }
    });
    it("retains each child's explicit Host parent and admitted ancestry before execution without accepting forged domain bindings", async () => {
        const h = await fixture();
        try {
            const registry = new CapabilityRegistry({ policyEngine: new PolicyEngine({ runKind: "chat-with-actions", allowWrite: true,
                allowedActionPermissions: ["local-filesystem-write"] }) });
            registry.registerMany((await h.service.provider.load({} as never)).capabilities);
            const executor = createOperationsStagingToolExecutor({ registry, controller: h.session, resourceContext: h.context,
                intentExecutor: input => h.session.executeCurrentIntent(input), baseExecutor: { execute: async () => { throw new Error("wrong owner"); } } });
            const makeChild = (suffix: string) => {
                const file = h.vault.file(`assets/source-${suffix}.txt`, suffix);
                const resourceRef = h.sourceRun.resolveResourceIdentity({ path: file.path })!.resourceRef;
                const inputLineage = completeInputLineage([{ kind: "vault", path: file.path, resourceRef, via: "note" }]);
                const call = { type: "toolCall" as const, name: "obsidian.vault.mkdir", id: `child-${suffix}`, index: 0,
                    input: { path: `assets/folder-${suffix}` } };
                return { runId: "run", turnId: "turn", turnIndex: 1, userInput: "Create", signal: new AbortController().signal,
                    taskSourceReadGuard: h.guard, toolCalls: [call], inputLineage,
                    hostParentBinding: { parentToolCallId: `parent-${suffix}`, parentAssistantId: `assistant-${suffix}` } };
            };
            const a = makeChild("A"), b = makeChild("B");
            const expectedA = JSON.parse(JSON.stringify(a.inputLineage));
            expect((await executor.prepareBatch!(a))!.toolResults.size).toBe(0);
            expect((await executor.prepareBatch!(b))!.toolResults.size).toBe(0);
            a.hostParentBinding.parentToolCallId = "changed-after-preparation";
            a.inputLineage.dependencies.push({ kind: "user-text", messageId: "changed-after-preparation" });
            const intentA = h.session.getCallContextResult("run", "turn", "child-A").intent!;
            const intentB = h.session.getCallContextResult("run", "turn", "child-B").intent!;
            expect(intentA).toMatchObject({ hostParentBinding: { parentToolCallId: "parent-A", parentAssistantId: "assistant-A" },
                inputLineage: expectedA, operations: [{ toolCallId: "child-A" }] });
            expect(intentB).toMatchObject({ hostParentBinding: b.hostParentBinding, inputLineage: b.inputLineage,
                operations: [{ toolCallId: "child-B" }] });
            expect(intentA.id).not.toBe(intentB.id); expect(Object.isFrozen(intentA.inputLineage)).toBe(true);
            expect(Object.isFrozen(intentA.hostParentBinding)).toBe(true); expect(h.vault.createFolder).not.toHaveBeenCalled();
            const forged = makeChild("forged");
            forged.toolCalls[0].input = { path: "assets/forged", hostParentBinding: { parentToolCallId: "fake", parentAssistantId: "fake" } } as never;
            expect((await executor.prepareBatch!(forged))!.toolResults.get("child-forged")?.outcome).toBe("schema_invalid");
            expect(h.session.getCallContextResult("run", "turn", "child-forged").intent).toBeUndefined();
            expect(h.vault.createFolder).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("preserves the real owner's pending/running identity and projects its completed SDK result without resubmitting", async () => {
        const h = await fixture(); let release!: () => void; let started!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { started = resolve; });
        try {
            h.vault.create.mockImplementationOnce(async (path, text) => { started(); await blocked; return h.vault.file(path, text); });
            const registry = new CapabilityRegistry({ policyEngine: new PolicyEngine({ runKind: "chat-with-actions", allowWrite: true, allowedActionPermissions: ["local-filesystem-write"] }) });
            registry.registerMany((await h.service.provider.load({} as never)).capabilities);
            const executor = createOperationsStagingToolExecutor({ registry, controller: h.session, resourceContext: h.context,
                intentExecutor: input => h.session.executeCurrentIntent(input), baseExecutor: { execute: async () => { throw new Error("wrong owner"); } } });
            const call = { type: "toolCall" as const, name: "obsidian.vault.createText", id: "pending-create", index: 0, input: { path: "assets/new.txt", text: "new" } };
            const batch = { runId: "run", turnId: "turn", turnIndex: 1, userInput: "Create", toolCalls: [call], signal: new AbortController().signal, taskSourceReadGuard: h.guard };
            expect((await executor.prepareBatch!(batch))!.toolResults.size).toBe(0);
            expect(h.service.provider.ownsCapability(registry.get(call.name)!)).toBe(true);
            const ownerContext = { runId: "run", turnId: "turn", toolCallId: call.id, toolName: call.name };
            const pending = executor.getAttemptObservation!(ownerContext)!;
            expect(pending).toMatchObject({ executionState: "not_started", metadata: { state: "pending", ownerPrepared: true } });
            const originalId = pending.metadata?.intentId;
            const completing = executor.execute({ ...batch, toolCall: call }); await entered;
            const running = executor.getAttemptObservation!(ownerContext)!;
            expect(running).toMatchObject({ executionState: "running", metadata: { intentId: originalId } });
            expect(running.resultFact).toMatchObject({ kind: "operations_result", observation: { intentId: originalId, state: "executing" } });
            expect(h.vault.create).toHaveBeenCalledTimes(1);
            release(); const result = await completing;
            expect(JSON.parse(result.promptText)).toMatchObject({ ok: true, value: { state: "completed" } });
            expect(result.metadata?.sdkOnly).toBe(true);
            expect(result.resultFact).toMatchObject({ kind: "operations_result", observation: { intentId: originalId, state: "completed" } });
            expect(executor.getAttemptObservation!(ownerContext)!.resultFact).toEqual(result.resultFact);
        } finally { release(); h.service.dispose(); }
    });
});
