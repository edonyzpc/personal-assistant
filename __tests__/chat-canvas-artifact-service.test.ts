import { describe, expect, it, jest } from "@jest/globals";
import { FileView, TFile, TFolder, type App, type WorkspaceLeaf } from "obsidian";
import type { SourceAccess } from "../src/plugin/source-access";
import type { ChatHistoryManager } from "../src/chat/chat-history-manager";
import { CanvasArtifactService, type CanvasArtifactSource } from "../src/chat/canvas/canvas-artifact-service";
import type { CanvasArtifactRecord } from "../src/chat/canvas/types";
import { stableHash } from "../src/pa/helpers";

jest.mock("obsidian", () => {
    class TFile { path = ""; extension = "canvas"; }
    class TFolder { path = ""; }
    class FileView { file?: TFile; }
    return { TFile, TFolder, FileView, normalizePath: (value: string) => value.replace(/\/+/g, "/") };
});

const raw = '{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":100,"height":80,"text":"# Service Canvas"}]}';
const messageContent = `Before\n\`\`\`canvas\n${raw}\n\`\`\`\n`;
const source: CanvasArtifactSource = {
    conversationId: "conv", turnIndex: 3, messageId: "assistant-1", userMessageSourceHash: stableHash("original user"),
    messageContent, raw, block: { language: "canvas", startLine: 2, sourceHash: stableHash(raw), occurrence: 0 },
    isCurrent: () => true,
};

function file(path: string): TFile { return Object.assign(new TFile(), { path, extension: "canvas" }); }
function folder(path: string): TFolder { return Object.assign(new TFolder(), { path }); }
function view(file: TFile | null, type = "canvas"): FileView {
    return Object.assign(Object.create(FileView.prototype) as FileView, { file, getViewType: () => type });
}
function deferred<Value>() {
    let resolve!: (value: Value) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Value>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function serviceFixture(options: {
    managerUpdate?: ChatHistoryManager["updateCanvasArtifacts"];
    create?: (path: string, data: string) => Promise<TFile>;
    leaves?: WorkspaceLeaf[];
} = {}) {
    const files = new Map<string, TFile>();
    const contents = new Map<string, string>();
    const folders = new Map([["Source", folder("Source")], ["", folder("")]]);
    const policy = { allowed: true };
    const handlers = new Map<string, (file: TFile, oldPath?: string) => void>();
    const records: CanvasArtifactRecord[] = [];
    const revealLeaf = jest.fn(async (_leaf: WorkspaceLeaf) => undefined);
    const newLeaf = { view: view(null) } as unknown as WorkspaceLeaf;
    const openFile = jest.fn(async (target: TFile, _state?: Parameters<WorkspaceLeaf["openFile"]>[1]) => {
        newLeaf.view = view(target);
    });
    newLeaf.openFile = openFile;
    const getLeaf = jest.fn(() => newLeaf);
    const getNewFileParent = jest.fn((_sourcePath: string, _filename?: string) => folder("Source"));
    const create = jest.fn(options.create ?? (async (path: string, data: string) => {
        const created = file(path);
        files.set(path, created);
        contents.set(path, data);
        return created;
    }));
    const cachedRead = jest.fn(async (target: TFile) => contents.get(target.path) ?? raw);
    const getAbstractFileByPath = jest.fn((path: string) => files.get(path) ?? folders.get(path) ?? null);
    const defaultUpdate: ChatHistoryManager["updateCanvasArtifacts"] = async (_binding, transform) => {
        const next = transform(records);
        records.splice(0, records.length, ...next);
        return next;
    };
    const updateCanvasArtifacts = jest.fn(options.managerUpdate ?? defaultUpdate);
    const app = {
        fileManager: { getNewFileParent, renameFile: jest.fn() },
        vault: {
            on: jest.fn((event: string, callback: (file: TFile, oldPath?: string) => void) => { handlers.set(event, callback); return {}; }),
            getAbstractFileByPath,
            getRoot: () => folder(""), cachedRead, create,
        },
        workspace: { getLeavesOfType: () => options.leaves ?? [], getLeaf, revealLeaf },
    } as unknown as App;
    const service = new CanvasArtifactService({
        app,
        sourceAccess: {
            isDataBoundaryAllowedPath: () => policy.allowed,
            isDataBoundaryAllowedFile: () => policy.allowed,
        } as unknown as SourceAccess,
        getHistoryManager: () => ({ updateCanvasArtifacts }) as unknown as ChatHistoryManager,
        registerEvent: jest.fn(), log: jest.fn(),
    });
    return { app, service, records, revealLeaf, openFile, getLeaf, newLeaf, getNewFileParent, files, contents,
        create, cachedRead, getAbstractFileByPath, updateCanvasArtifacts, policy, handlers };
}

function savedRecord(phase: "pending" | "saved" = "saved"): CanvasArtifactRecord {
    return { version: 1, id: "existing-canvas", block: { ...source.block },
        save: { operationId: "original-save", phase, path: "Source/service.canvas", sourceHash: stableHash(raw) } };
}

describe("Canvas artifact save service", () => {
    it.each(["saved", "pending"] as const)("rejects an invalid restored %s path before any host file access", async phase => {
        const fixture = serviceFixture();
        const record = savedRecord(phase);
        record.save!.path = "file:/private/tmp/external.canvas";
        fixture.files.set(record.save!.path, file(record.save!.path));
        const restored = { ...source, records: [record] };

        expect(fixture.service.resolveArtifact(restored)).toEqual({ status: "invalid" });
        await expect(fixture.service.verifyPending({ source: restored, artifactId: record.id })).resolves.toBe("unconfirmed");
        await expect(fixture.service.openCandidate({ source: restored, artifactId: record.id, isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "failed" });
        await expect(fixture.service.open({ source: restored, artifactId: record.id, isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "failed" });
        await expect(fixture.service.save({ source: restored, artifactId: record.id, path: "Source/copy.canvas", isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "not-saved" });
        expect(fixture.getAbstractFileByPath).not.toHaveBeenCalled();
        expect(fixture.cachedRead).not.toHaveBeenCalled();
        expect(fixture.openFile).not.toHaveBeenCalled();
        expect(fixture.create).not.toHaveBeenCalled();
    });

    it("restores a valid saved association and opens its latest contents without replaying creation", async () => {
        const fixture = serviceFixture();
        const record = savedRecord();
        const target = file(record.save!.path);
        fixture.files.set(target.path, target);
        fixture.contents.set(target.path, "native edits after saving");
        const restored = { ...source, records: [record] };

        expect(fixture.service.resolveArtifact(restored)).toMatchObject({ status: "ready", fileState: "available", path: target.path });
        expect(fixture.openFile).not.toHaveBeenCalled();
        await expect(fixture.service.open({ source: restored, artifactId: record.id, isViewCurrent: () => true }))
            .resolves.toEqual({ phase: "opened" });
        expect(fixture.openFile).toHaveBeenCalledWith(target, { active: false });
        expect(fixture.cachedRead).not.toHaveBeenCalled();
        expect(fixture.create).not.toHaveBeenCalled();
    });

    it("reports a failed pending transaction as not saved without claiming an existing file", async () => {
        const fixture = serviceFixture({ managerUpdate: async () => { throw new Error("storage unavailable"); } });
        const input = { ...source };
        const binding = fixture.service.resolveArtifact(input);
        const result = await fixture.service.save({ source: input, artifactId: binding.id!, path: "Source/new.canvas", isViewCurrent: () => true });
        expect(result).toMatchObject({ phase: "not-saved", reason: "create-failed" });
        expect(result.file).toBeUndefined();
        expect(fixture.create).not.toHaveBeenCalled();
    });
    it("derives a default from captured source and shows a non-conflicting suggestion", () => {
        const fixture = serviceFixture();
        fixture.files.set("Source/Service Canvas.canvas", file("Source/Service Canvas.canvas"));
        expect(fixture.service.defaultPath(raw, "Source/note.md")).toBe("Source/Service Canvas.canvas");
        expect(fixture.getNewFileParent).toHaveBeenCalledWith("Source/note.md", "Service Canvas.canvas");
        expect(fixture.service.suggestPath(raw, "Source/note.md")).toBe("Source/Service Canvas 2.canvas");
    });

    it("persists pending before one final-path create and lets another current view finish the shared operation", async () => {
        const created = deferred<TFile>();
        const createStarted = deferred<void>();
        const fixture = serviceFixture({ create: async () => { createStarted.resolve(); return created.promise; } });
        let firstCurrent = true;
        const artifactId = fixture.service.resolveArtifact(source).id!;
        const first = fixture.service.save({ source, artifactId, path: "Source/service.canvas", isViewCurrent: () => firstCurrent });
        const second = fixture.service.save({ source, artifactId, path: "Source/other.canvas", isViewCurrent: () => true });
        await createStarted.promise;
        expect(fixture.records[0]).toMatchObject({ save: { phase: "pending", path: "Source/service.canvas" } });
        firstCurrent = false;
        const target = file("Source/service.canvas");
        fixture.files.set(target.path, target);
        created.resolve(target);
        const results = await Promise.all([first, second]);
        expect(results[0]).toMatchObject({ phase: "saved", path: target.path });
        expect(results[1]).toEqual(results[0]);
        expect(fixture.create).toHaveBeenCalledTimes(1);
        expect(fixture.create).toHaveBeenCalledWith(target.path, raw);
        expect(fixture.records[0]).toMatchObject({ save: { phase: "saved", path: target.path } });
        expect(fixture.updateCanvasArtifacts.mock.calls[0][0]).toMatchObject({ userMessageSourceHash: source.userMessageSourceHash });
        expect(fixture.app.fileManager.renameFile).not.toHaveBeenCalled();
        expect(fixture.openFile).toHaveBeenCalledTimes(1);
    });

    it("records an already-created file after closing without opening a late tab", async () => {
        const created = deferred<TFile>();
        const createStarted = deferred<void>();
        const fixture = serviceFixture({ create: async () => { createStarted.resolve(); return created.promise; } });
        let current = true;
        const result = fixture.service.save({ source, artifactId: fixture.service.resolveArtifact(source).id!,
            path: "Source/service.canvas", isViewCurrent: () => current });
        await createStarted.promise;
        current = false;
        const target = file("Source/service.canvas");
        fixture.files.set(target.path, target);
        created.resolve(target);
        await expect(result).resolves.toMatchObject({ phase: "saved-open-failed", reason: "view-closed" });
        expect(fixture.records[0]).toMatchObject({ save: { phase: "saved", path: target.path } });
        expect(fixture.getLeaf).not.toHaveBeenCalled();
    });

    it("rechecks target admission after the pending transaction before creating", async () => {
        const pending = deferred<void>();
        const fixture = serviceFixture({ managerUpdate: async (_binding, transform) => {
            const next = transform([]);
            await pending.promise;
            return next;
        } });
        const result = fixture.service.save({ source, artifactId: fixture.service.resolveArtifact(source).id!,
            path: "Source/service.canvas", isViewCurrent: () => true });
        fixture.policy.allowed = false;
        pending.resolve();
        await expect(result).resolves.toMatchObject({ phase: "not-saved", reason: "target-denied" });
        expect(fixture.create).not.toHaveBeenCalled();
    });

    it("keeps an association failure separate and retries only recording/opening after native edits", async () => {
        let failSaved = true;
        const persisted: CanvasArtifactRecord[] = [];
        const fixture = serviceFixture({ managerUpdate: async (_binding, transform) => {
            const next = transform(persisted);
            if (next[0]?.save?.phase === "saved" && failSaved) throw new Error("storage failed");
            persisted.splice(0, persisted.length, ...next);
            return next;
        } });
        const artifactId = fixture.service.resolveArtifact(source).id!;
        await expect(fixture.service.save({ source, artifactId, path: "Source/service.canvas", isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "saved-association-failed" });
        fixture.contents.set("Source/service.canvas", "native edits");
        failSaved = false;
        const staleSource = { ...source, records: persisted.map(record => ({ ...record })) };
        await expect(fixture.service.save({ source: staleSource, artifactId, path: "Source/other.canvas", isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "saved", path: "Source/service.canvas" });
        expect(fixture.create).toHaveBeenCalledTimes(1);
        expect(fixture.cachedRead).not.toHaveBeenCalled();
        expect(persisted[0]).toMatchObject({ save: { phase: "saved" } });
    });

    it("tracks native rename by file identity and does not regress to stale view records", async () => {
        const fixture = serviceFixture();
        const bound = { ...source, records: [savedRecord()] };
        const target = file("Source/service.canvas");
        fixture.files.set(target.path, target);
        const artifactId = fixture.service.resolveArtifact(bound).id!;
        const listener = jest.fn();
        const unsubscribe = fixture.service.subscribe(artifactId, listener);
        fixture.files.delete(target.path);
        target.path = "Source/renamed.canvas";
        fixture.files.set(target.path, target);
        fixture.handlers.get("rename")!(target, "Source/service.canvas");
        await Promise.resolve();
        expect(fixture.service.resolveArtifact(bound)).toMatchObject({ path: target.path, record: { save: { path: target.path } } });
        expect(fixture.records[0]).toMatchObject({ save: { path: target.path } });
        expect(listener).toHaveBeenCalled();
        unsubscribe();
    });

    it("does not adopt a same-path replacement of a known file and requires an explicit resave", async () => {
        const fixture = serviceFixture();
        const bound = { ...source, records: [savedRecord()] };
        const original = file("Source/service.canvas");
        fixture.files.set(original.path, original);
        const artifactId = fixture.service.resolveArtifact(bound).id!;
        fixture.files.set(original.path, file(original.path));
        await expect(fixture.service.open({ source: bound, artifactId, isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "missing", reason: "file-missing" });
        expect(fixture.getLeaf).not.toHaveBeenCalled();
        await expect(fixture.service.save({ source: bound, artifactId, path: "Source/copy.canvas", isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "saved-open-failed", reason: "file-missing" });
        expect(fixture.create).not.toHaveBeenCalled();
        await expect(fixture.service.save({ source: bound, artifactId, path: "Source/copy.canvas", recreateMissing: true, isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "saved", path: "Source/copy.canvas" });
        expect(fixture.create).toHaveBeenCalledTimes(1);
    });

    it("keeps a changed unknown-create target unconfirmed and allows only explicit inspection", async () => {
        const target = file("Source/service.canvas");
        const fixture = serviceFixture({ create: async () => {
            fixture.files.set(target.path, target);
            fixture.contents.set(target.path, "different canvas bytes");
            throw new Error("create result lost");
        } });
        const artifactId = fixture.service.resolveArtifact(source).id!;
        await expect(fixture.service.save({ source, artifactId, path: target.path, isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "unknown", reason: "result-unconfirmed" });
        expect(fixture.openFile).not.toHaveBeenCalled();
        await expect(fixture.service.save({ source, artifactId, path: "Source/copy.canvas", isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "unknown" });
        expect(fixture.create).toHaveBeenCalledTimes(1);
        await expect(fixture.service.openCandidate({ source, artifactId, isViewCurrent: () => true })).resolves.toEqual({ phase: "opened" });
        expect(fixture.service.resolveArtifact(source).fileState).toBe("unconfirmed");
        expect(fixture.records[0].save?.phase).toBe("pending");
    });

    it.each(["identity", "policy", "source"])("rejects a pending target when %s changes during its read", async change => {
        const fixture = serviceFixture();
        let current = true;
        const bound = { ...source, isCurrent: () => current, records: [savedRecord("pending")] };
        const target = file("Source/service.canvas");
        fixture.files.set(target.path, target);
        const artifactId = fixture.service.resolveArtifact(bound).id!;
        const read = deferred<string>();
        fixture.cachedRead.mockImplementationOnce(() => read.promise);
        const result = fixture.service.verifyPending({ source: bound, artifactId });
        if (change === "identity") fixture.files.set(target.path, file(target.path));
        if (change === "policy") fixture.policy.allowed = false;
        if (change === "source") current = false;
        read.resolve(raw);
        await expect(result).resolves.toBe("unconfirmed");
        expect(fixture.records).toEqual([]);
        expect(fixture.service.resolveArtifact(bound).fileState).toBe("unconfirmed");
    });

    it("shares a native open already started by saving with an open from another view", async () => {
        const fixture = serviceFixture();
        const nativeOpened = deferred<void>();
        const openStarted = deferred<void>();
        fixture.openFile.mockImplementation(async target => {
            openStarted.resolve();
            await nativeOpened.promise;
            fixture.newLeaf.view = view(target);
        });
        const artifactId = fixture.service.resolveArtifact(source).id!;
        const save = fixture.service.save({ source, artifactId, path: "Source/service.canvas", isViewCurrent: () => true });
        await openStarted.promise;
        const open = fixture.service.open({ source, artifactId, isViewCurrent: () => true });
        nativeOpened.resolve();
        await expect(save).resolves.toMatchObject({ phase: "saved" });
        await expect(open).resolves.toEqual({ phase: "opened" });
        expect(fixture.getLeaf).toHaveBeenCalledTimes(1);
        expect(fixture.openFile).toHaveBeenCalledTimes(1);
        expect(fixture.revealLeaf).toHaveBeenCalledTimes(1);
    });

    it("admits a second save caller joining during deferred native loading", async () => {
        const fixture = serviceFixture();
        const nativeOpened = deferred<void>();
        const openStarted = deferred<void>();
        fixture.openFile.mockImplementation(async target => {
            openStarted.resolve();
            await nativeOpened.promise;
            fixture.newLeaf.view = view(target);
        });
        let firstCurrent = true;
        const artifactId = fixture.service.resolveArtifact(source).id!;
        const first = fixture.service.save({ source, artifactId, path: "Source/service.canvas", isViewCurrent: () => firstCurrent });
        await openStarted.promise;
        firstCurrent = false;
        const second = fixture.service.save({ source, artifactId, path: "Source/other.canvas", isViewCurrent: () => true });
        nativeOpened.resolve();
        await expect(first).resolves.toMatchObject({ phase: "saved" });
        await expect(second).resolves.toMatchObject({ phase: "saved" });
        expect(fixture.getLeaf).toHaveBeenCalledTimes(1);
        expect(fixture.revealLeaf).toHaveBeenCalledTimes(1);
    });

    it("rechecks the original pending operation without replay and identifies a missing target as unsaved", async () => {
        const fixture = serviceFixture();
        const bound = { ...source, records: [savedRecord("pending")] };
        const artifactId = fixture.service.resolveArtifact(bound).id!;
        await expect(fixture.service.verifyPending({ source: bound, artifactId })).resolves.toBe("unsaved");
        expect(fixture.service.resolveArtifact(bound).fileState).toBeUndefined();
        expect(fixture.service.resolveArtifact(bound).path).toBeUndefined();
        const target = file("Source/service.canvas");
        fixture.files.set(target.path, target);
        await expect(fixture.service.verifyPending({ source: bound, artifactId })).resolves.toBe("saved");
        expect(fixture.records[0]).toMatchObject({ save: { phase: "saved", path: target.path } });
        expect(fixture.create).not.toHaveBeenCalled();
        expect(fixture.openFile).not.toHaveBeenCalled();
    });

    it("loads only a matching deferred leaf and rechecks lifetime before revealing or creating a tab", async () => {
        const target = file("Source/service.canvas");
        const loading = deferred<void>();
        const unrelatedLoad = jest.fn(async () => undefined);
        const matchingLoad = jest.fn(() => loading.promise);
        const leaves = [
            { view: view(null), getViewState: () => ({ type: "canvas", state: { file: "Source/unrelated.canvas" } }), loadIfDeferred: unrelatedLoad },
            { view: view(target), getViewState: () => ({ type: "canvas", state: { file: target.path } }), loadIfDeferred: matchingLoad },
        ] as unknown as WorkspaceLeaf[];
        const fixture = serviceFixture({ leaves });
        fixture.files.set(target.path, target);
        const bound = { ...source, records: [savedRecord()] };
        let current = true;
        const result = fixture.service.open({ source: bound, artifactId: fixture.service.resolveArtifact(bound).id!, isViewCurrent: () => current });
        current = false;
        loading.resolve();
        await expect(result).resolves.toMatchObject({ phase: "failed", reason: "view-closed" });
        expect(unrelatedLoad).not.toHaveBeenCalled();
        expect(matchingLoad).toHaveBeenCalledTimes(1);
        expect(fixture.revealLeaf).not.toHaveBeenCalled();
        expect(fixture.getLeaf).not.toHaveBeenCalled();
    });

    it("verifies the opened view is native Canvas and keeps an open failure from recreating the file", async () => {
        const fixture = serviceFixture();
        fixture.openFile.mockImplementation(async target => { fixture.newLeaf.view = view(target, "markdown"); });
        const artifactId = fixture.service.resolveArtifact(source).id!;
        await expect(fixture.service.save({ source, artifactId, path: "Source/service.canvas", isViewCurrent: () => true }))
            .resolves.toMatchObject({ phase: "saved-open-failed", reason: "native-unavailable" });
        expect(fixture.revealLeaf).not.toHaveBeenCalled();
        fixture.openFile.mockImplementation(async target => { fixture.newLeaf.view = view(target); });
        await expect(fixture.service.open({ source, artifactId, isViewCurrent: () => true })).resolves.toEqual({ phase: "opened" });
        expect(fixture.create).toHaveBeenCalledTimes(1);
    });
});
