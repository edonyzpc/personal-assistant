import { FileView, TFile, TFolder, normalizePath, type App, type EventRef } from "obsidian";
import { validateResourceVaultPath } from "../../ai-services/operations/vault-path";
import { stableHash } from "../../pa/helpers";
import { getPlatformCrypto } from "../../platform-dom";
import type { SourceAccess } from "../../plugin/source-access";
import type { ChatHistoryManager } from "../chat-history-manager";
import { deriveCanvasTitle } from "./canvas-blocks";
import type { CanvasArtifactRecord, CanvasArtifactUpdateBinding } from "./types";

export interface CanvasArtifactSource {
    conversationId: string;
    turnIndex: number;
    messageId?: string;
    userMessageSourceHash?: string;
    messageContent: string;
    raw: string;
    block: CanvasArtifactRecord["block"];
    records?: CanvasArtifactRecord[];
    recordsInvalid?: boolean;
    isCurrent(this: void): boolean;
}

export interface CanvasArtifactBinding {
    status: "ready" | "invalid";
    id?: string;
    record?: CanvasArtifactRecord;
    fileState?: "available" | "missing" | "unconfirmed";
    path?: string;
    associationRecorded?: boolean;
}

export type CanvasArtifactReason = "source-changed" | "view-closed" | "invalid-path" | "target-denied"
    | "folder-missing" | "target-conflict" | "history-unavailable" | "association-failed"
    | "create-failed" | "result-unconfirmed" | "file-missing" | "file-denied"
    | "native-unavailable" | "open-failed";

export interface CanvasSaveResult {
    phase: "saved" | "saved-association-failed" | "saved-open-failed" | "not-saved" | "unknown";
    path: string;
    file?: TFile;
    reason?: CanvasArtifactReason;
    message?: string;
}

export interface CanvasOpenResult {
    phase: "opened" | "missing" | "failed";
    reason?: CanvasArtifactReason;
    message?: string;
}

interface ServiceArtifact {
    binding: CanvasArtifactUpdateBinding;
    block: CanvasArtifactRecord["block"];
    id: string;
    record?: CanvasArtifactRecord;
    file?: TFile;
    invalidated?: boolean;
    pendingAbsent?: boolean;
    associationRecorded: boolean;
    /** Serialize narrow writes so an older rename cannot land after a newer one. */
    recordWrite?: Promise<void>;
}

interface CurrentCaller {
    sourceIsCurrent(this: void): boolean;
    isViewCurrent(this: void): boolean;
}

interface Flight<Result> {
    callers: Set<CurrentCaller>;
    promise: Promise<Result>;
}

interface CanvasArtifactServiceOptions {
    app: App;
    sourceAccess: SourceAccess;
    getHistoryManager(): ChatHistoryManager | undefined;
    registerEvent?(eventRef: EventRef): void;
    log(message: string, error?: unknown): void;
}

class CanvasServiceError extends Error {
    constructor(readonly reason: CanvasArtifactReason) { super(reason); }
}

function artifactKey(source: CanvasArtifactSource): string {
    return JSON.stringify([
        source.conversationId, source.turnIndex, source.messageId ?? "", source.userMessageSourceHash ?? "",
        stableHash(source.messageContent), source.block.language, source.block.sourceHash, source.block.occurrence,
    ]);
}

function matchesRecord(source: CanvasArtifactSource, record: CanvasArtifactRecord): boolean {
    return record.block.language === source.block.language
        && record.block.sourceHash === source.block.sourceHash
        && record.block.occurrence === source.block.occurrence
        && record.block.startLine === source.block.startLine;
}

function uniqueId(prefix: string): string {
    const uuid = getPlatformCrypto()?.randomUUID() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${uuid.replace(/-/g, "")}`;
}

function updateBinding(source: CanvasArtifactSource): CanvasArtifactUpdateBinding {
    return {
        conversationId: source.conversationId,
        turnIndex: source.turnIndex,
        ...(source.messageId ? { assistantMessageId: source.messageId } : {}),
        ...(source.userMessageSourceHash ? { userMessageSourceHash: source.userMessageSourceHash } : {}),
        messageSourceHash: stableHash(source.messageContent),
    };
}

function mergeRecord(records: CanvasArtifactRecord[], record: CanvasArtifactRecord): CanvasArtifactRecord[] {
    return [...records.filter(candidate => candidate.id !== record.id), record]
        .sort((left, right) => left.block.startLine - right.block.startLine || left.id.localeCompare(right.id));
}

function canProceed(callers: ReadonlySet<CurrentCaller>): boolean {
    return [...callers].some(caller => caller.sourceIsCurrent() && caller.isViewCurrent());
}

function failed(reason: CanvasArtifactReason, phase: CanvasOpenResult["phase"] = "failed"): CanvasOpenResult {
    return { phase, reason };
}

function validateCanvasPath(path: string): string {
    let normalized: string;
    try { normalized = validateResourceVaultPath(path); }
    catch { throw new CanvasServiceError("invalid-path"); }
    if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) || !normalized.toLowerCase().endsWith(".canvas")) {
        throw new CanvasServiceError("invalid-path");
    }
    return normalized;
}

export class CanvasArtifactService {
    private readonly artifacts = new Map<string, ServiceArtifact>();
    private readonly saveFlights = new Map<string, Flight<CanvasSaveResult>>();
    private readonly openFlights = new Map<string, Flight<CanvasOpenResult>>();
    private readonly listeners = new Map<string, Set<() => void>>();

    constructor(private readonly options: CanvasArtifactServiceOptions) {
        const renameRef = this.options.app.vault.on("rename", file => {
            if (!(file instanceof TFile)) return;
            for (const artifact of this.artifacts.values()) {
                if (artifact.file !== file || artifact.record?.save?.phase !== "saved") continue;
                const record: CanvasArtifactRecord = { ...artifact.record,
                    save: { ...artifact.record.save, path: file.path } };
                artifact.record = record;
                artifact.associationRecorded = false;
                this.notify(artifact);
                void this.persistRecord(artifact, record).catch(error => {
                    this.options.log("Failed to update renamed Canvas association", error);
                });
            }
        });
        const deleteRef = this.options.app.vault.on("delete", file => {
            for (const artifact of this.artifacts.values()) {
                if (artifact.file !== file) continue;
                artifact.file = undefined;
                artifact.invalidated = true;
                this.notify(artifact);
            }
        });
        this.options.registerEvent?.(renameRef);
        this.options.registerEvent?.(deleteRef);
    }

    subscribe(artifactId: string, listener: () => void): () => void {
        const listeners = this.listeners.get(artifactId) ?? new Set<() => void>();
        listeners.add(listener);
        this.listeners.set(artifactId, listeners);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) this.listeners.delete(artifactId);
        };
    }

    private notify(artifact: ServiceArtifact): void {
        for (const listener of this.listeners.get(artifact.id) ?? []) listener();
    }

    resolveArtifact(source: CanvasArtifactSource): CanvasArtifactBinding {
        if (source.recordsInvalid) return { status: "invalid" };
        const key = artifactKey(source);
        let artifact = this.artifacts.get(key);
        let record = source.records?.find(candidate => matchesRecord(source, candidate));
        if (!artifact?.record && record?.save) {
            // Persisted paths are location hints, not trusted host file handles.
            // Reject corrupt associations before any recovery lookup or read.
            try { record = { ...record, save: { ...record.save, path: validateCanvasPath(record.save.path) } }; }
            catch { return { status: "invalid" }; }
        }
        if (!artifact) {
            artifact = { binding: updateBinding(source), block: { ...source.block }, id: record?.id ?? uniqueId("canvas"),
                record, associationRecorded: Boolean(record) };
            this.artifacts.set(key, artifact);
        } else if (!artifact.record && record) {
            // A preview may mount before its history metadata arrives. Once known,
            // service facts own subsequent changes; stale view props cannot rewind them.
            artifact.id = record.id;
            artifact.record = record;
            artifact.associationRecorded = true;
        }
        const save = artifact.record?.save;
        return {
            status: "ready", id: artifact.id, record: artifact.record,
            ...(save && !artifact.pendingAbsent ? { path: artifact.file?.path ?? save.path } : {}),
            ...(save ? { associationRecorded: artifact.associationRecorded } : {}),
            ...(save?.phase === "saved" ? { fileState: this.currentFile(artifact) ? "available" as const : "missing" as const }
                : save && !artifact.pendingAbsent ? { fileState: "unconfirmed" as const } : {}),
        };
    }

    defaultPath(raw: string, capturedSourcePath: string): string {
        const filename = `${deriveCanvasTitle(raw)}.canvas`;
        const parent = this.options.app.fileManager.getNewFileParent(capturedSourcePath, filename);
        return normalizePath(`${parent.path && parent.path !== "/" ? `${parent.path}/` : ""}${filename}`);
    }

    suggestPath(raw: string, capturedSourcePath: string): string {
        const path = this.defaultPath(raw, capturedSourcePath);
        if (!this.options.app.vault.getAbstractFileByPath(path)) return path;
        const base = path.slice(0, -".canvas".length);
        let suffix = 2;
        while (this.options.app.vault.getAbstractFileByPath(`${base} ${suffix}.canvas`)) suffix += 1;
        return `${base} ${suffix}.canvas`;
    }

    validateTargetPath(path: string): string {
        const normalized = validateCanvasPath(path);
        if (!this.options.sourceAccess.isDataBoundaryAllowedPath(normalized)) throw new CanvasServiceError("target-denied");
        return normalized;
    }

    private persistRecord(artifact: ServiceArtifact, record: CanvasArtifactRecord): Promise<void> {
        const write = async () => {
            const manager = this.options.getHistoryManager();
            if (!manager) throw new CanvasServiceError("history-unavailable");
            // The store checks the original message atomically. View lifetime must
            // not prevent recording an already-created file or a native rename.
            const updated = await manager.updateCanvasArtifacts(artifact.binding, current => mergeRecord(current, record));
            if (!updated) throw new CanvasServiceError("source-changed");
            if (artifact.record === record) {
                artifact.associationRecorded = true;
                this.notify(artifact);
            }
        };
        const promise = artifact.recordWrite ? artifact.recordWrite.catch(() => undefined).then(write) : write();
        artifact.recordWrite = promise;
        void promise.finally(() => {
            if (artifact.recordWrite === promise) artifact.recordWrite = undefined;
        }).catch(() => undefined);
        return promise;
    }

    private verifyTarget(path: string): void {
        const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        const parent = parentPath ? this.options.app.vault.getAbstractFileByPath(parentPath) : this.options.app.vault.getRoot();
        if (!(parent instanceof TFolder)) throw new CanvasServiceError("folder-missing");
        if (this.options.app.vault.getAbstractFileByPath(path)) throw new CanvasServiceError("target-conflict");
    }

    private currentFile(artifact: ServiceArtifact): TFile | null {
        if (artifact.invalidated) return null;
        if (artifact.file) {
            if (this.options.app.vault.getAbstractFileByPath(artifact.file.path) === artifact.file
                && artifact.file.extension.toLowerCase() === "canvas") return artifact.file;
            artifact.invalidated = true;
            return null;
        }
        const path = artifact.record?.save?.path;
        const file = path ? this.options.app.vault.getAbstractFileByPath(path) : null;
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== "canvas") return null;
        artifact.file = file;
        return file;
    }

    private async verifyUnknownCreate(path: string, raw: string, isCurrent: () => boolean): Promise<TFile | null> {
        if (!isCurrent() || !this.options.sourceAccess.isDataBoundaryAllowedPath(path)) throw new CanvasServiceError("result-unconfirmed");
        const file = this.options.app.vault.getAbstractFileByPath(path);
        if (!file) return null;
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== "canvas"
            || !this.options.sourceAccess.isDataBoundaryAllowedFile(file)) throw new CanvasServiceError("result-unconfirmed");
        const current = await this.options.app.vault.cachedRead(file);
        if (!isCurrent() || this.options.app.vault.getAbstractFileByPath(path) !== file
            || !this.options.sourceAccess.isDataBoundaryAllowedFile(file) || current !== raw) {
            throw new CanvasServiceError("result-unconfirmed");
        }
        return file;
    }

    async save(input: {
        source: CanvasArtifactSource;
        artifactId: string;
        path: string;
        recreateMissing?: boolean;
        isViewCurrent(this: void): boolean;
    }): Promise<CanvasSaveResult> {
        const binding = this.resolveArtifact(input.source);
        if (binding.status !== "ready" || binding.id !== input.artifactId || !input.source.isCurrent()) {
            return { phase: "not-saved", path: input.path, reason: "source-changed" };
        }
        const artifact = this.artifacts.get(artifactKey(input.source))!;
        const caller = { sourceIsCurrent: input.source.isCurrent, isViewCurrent: input.isViewCurrent };
        const running = this.saveFlights.get(artifact.id);
        if (running) { running.callers.add(caller); return running.promise; }
        const callers = new Set([caller]);
        const flight: Flight<CanvasSaveResult> = { callers, promise: this.performSave(artifact, {
            path: input.path, raw: input.source.raw, recreateMissing: input.recreateMissing,
        }, callers) };
        this.saveFlights.set(artifact.id, flight);
        try { return await flight.promise; }
        finally { this.saveFlights.delete(artifact.id); callers.clear(); }
    }

    private async performSave(artifact: ServiceArtifact, input: {
        path: string; raw: string; recreateMissing?: boolean;
    }, callers: Set<CurrentCaller>): Promise<CanvasSaveResult> {
        let path = input.path;
        try {
            if (artifact.record?.save?.phase === "pending") {
                const verified = await this.checkPending(artifact, input.raw, () => canProceed(callers));
                if (verified === "unconfirmed") return { phase: "unknown", path: artifact.record.save.path, reason: "result-unconfirmed" };
            }
            if (artifact.record?.save?.phase === "saved") {
                if (!input.recreateMissing || this.currentFile(artifact)) return this.openSaved(artifact, callers);
            }
            path = this.validateTargetPath(path);
            this.verifyTarget(path);
            if (!canProceed(callers)) return { phase: "not-saved", path, reason: "view-closed" };
            const pending: CanvasArtifactRecord = { version: 1, id: artifact.id, block: artifact.block,
                save: { operationId: uniqueId("canvas-save"), phase: "pending", path, sourceHash: stableHash(input.raw) } };
            await this.persistRecord(artifact, pending);
            artifact.record = pending;
            artifact.associationRecorded = true;
            artifact.pendingAbsent = false;
            this.notify(artifact);
            if (!canProceed(callers)) return { phase: "not-saved", path, reason: "view-closed" };
            // Policy and target can change while the pending transaction awaits.
            this.validateTargetPath(path);
            this.verifyTarget(path);
            let file: TFile;
            try { file = await this.options.app.vault.create(path, input.raw); }
            catch (error) {
                this.options.log("Canvas creation returned an error; checking the original target", error);
                try {
                    const verified = await this.verifyUnknownCreate(path, input.raw, () => canProceed(callers));
                    if (!verified) {
                        artifact.pendingAbsent = true;
                        this.notify(artifact);
                        return { phase: "not-saved", path, reason: "create-failed" };
                    }
                    file = verified;
                } catch { return { phase: "unknown", path, reason: "result-unconfirmed" }; }
            }
            artifact.file = file;
            artifact.invalidated = false;
            artifact.pendingAbsent = false;
            artifact.record = { ...pending, save: { ...pending.save!, phase: "saved", path: file.path } };
            artifact.associationRecorded = false;
            this.notify(artifact);
            return this.openSaved(artifact, callers);
        } catch (error) {
            this.options.log("Canvas save failed", error);
            return { phase: "not-saved", path, reason: error instanceof CanvasServiceError ? error.reason : "create-failed" };
        }
    }

    private async openSaved(artifact: ServiceArtifact, callers: Set<CurrentCaller>): Promise<CanvasSaveResult> {
        const record = artifact.record!;
        const file = this.currentFile(artifact);
        let associationFailed = !artifact.associationRecorded;
        if (associationFailed) {
            try { await this.persistRecord(artifact, record); associationFailed = !artifact.associationRecorded; }
            catch (error) { this.options.log("Created Canvas association is not recorded", error); }
        }
        const path = artifact.file?.path ?? record.save!.path;
        const opened = file ? await this.openShared(artifact, callers) : failed("file-missing", "missing");
        if (associationFailed) return { phase: "saved-association-failed", path, ...(file ? { file } : {}), reason: "association-failed" };
        return opened.phase === "opened" ? { phase: "saved", path, file: file! }
            : { phase: "saved-open-failed", path, ...(file ? { file } : {}), reason: opened.reason };
    }

    async verifyPending(input: { source: CanvasArtifactSource; artifactId: string }): Promise<"unsaved" | "saved" | "unconfirmed"> {
        const artifact = this.artifacts.get(artifactKey(input.source));
        if (!artifact || artifact.id !== input.artifactId || this.saveFlights.has(artifact.id)) return "unconfirmed";
        return this.checkPending(artifact, input.source.raw, input.source.isCurrent);
    }

    private async checkPending(artifact: ServiceArtifact, raw: string, isCurrent: () => boolean): Promise<"unsaved" | "saved" | "unconfirmed"> {
        const pending = artifact.record;
        if (pending?.save?.phase !== "pending") return pending?.save?.phase === "saved" ? "saved" : "unconfirmed";
        let file: TFile | null;
        try { file = await this.verifyUnknownCreate(pending.save.path, raw, isCurrent); }
        catch { return "unconfirmed"; }
        if (!file) {
            artifact.pendingAbsent = true;
            this.notify(artifact);
            return "unsaved";
        }
        artifact.file = file;
        artifact.record = { ...pending, save: { ...pending.save, phase: "saved", path: file.path } };
        artifact.associationRecorded = false;
        this.notify(artifact);
        try { await this.persistRecord(artifact, artifact.record); }
        catch (error) { this.options.log("Verified Canvas association is not recorded", error); }
        return "saved";
    }

    async open(input: { source: CanvasArtifactSource; artifactId: string; isViewCurrent(this: void): boolean }): Promise<CanvasOpenResult> {
        const binding = this.resolveArtifact(input.source);
        const artifact = this.artifacts.get(artifactKey(input.source));
        if (binding.status !== "ready" || !artifact || artifact.id !== input.artifactId || artifact.record?.save?.phase !== "saved") {
            return failed("result-unconfirmed");
        }
        const caller = { sourceIsCurrent: input.source.isCurrent, isViewCurrent: input.isViewCurrent };
        if (!artifact.associationRecorded) {
            try { await this.persistRecord(artifact, artifact.record); }
            catch (error) { this.options.log("Canvas association retry failed", error); }
        }
        return this.openShared(artifact, new Set([caller]));
    }

    private async openShared(artifact: ServiceArtifact, joining: ReadonlySet<CurrentCaller>): Promise<CanvasOpenResult> {
        // A second save caller can join while native loading is already pending.
        // Observe that live set rather than freezing only its first view.
        const group = { sourceIsCurrent: () => canProceed(joining), isViewCurrent: () => true };
        const running = this.openFlights.get(artifact.id);
        if (running) {
            running.callers.add(group);
            return running.promise;
        }
        const callers = new Set([group]);
        const flight: Flight<CanvasOpenResult> = { callers, promise: (async () => {
            const file = this.currentFile(artifact);
            return file ? this.openFile(file, () => canProceed(callers)) : failed("file-missing", "missing");
        })() };
        this.openFlights.set(artifact.id, flight);
        try { return await flight.promise; }
        finally { this.openFlights.delete(artifact.id); callers.clear(); }
    }

    async openCandidate(input: { source: CanvasArtifactSource; artifactId: string; isViewCurrent(this: void): boolean }): Promise<CanvasOpenResult> {
        const artifact = this.artifacts.get(artifactKey(input.source));
        if (!artifact || artifact.id !== input.artifactId || artifact.record?.save?.phase !== "pending") return failed("result-unconfirmed");
        const path = artifact.record.save.path;
        if (!this.options.sourceAccess.isDataBoundaryAllowedPath(path)) return failed("file-denied");
        const file = this.options.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== "canvas") return failed("file-missing", "missing");
        return this.openFile(file, () => input.source.isCurrent() && input.isViewCurrent());
    }

    private async openFile(file: TFile, isCurrent: () => boolean): Promise<CanvasOpenResult> {
        const current = (): boolean => isCurrent() && this.options.app.vault.getAbstractFileByPath(file.path) === file;
        const allowed = (): boolean => this.options.sourceAccess.isDataBoundaryAllowedFile(file);
        try {
            if (!current()) return failed("view-closed");
            if (!allowed()) return failed("file-denied");
            for (const leaf of this.options.app.workspace.getLeavesOfType("canvas")) {
                const state = leaf.getViewState();
                if (state.type !== "canvas" || state.state?.file !== file.path) continue;
                await leaf.loadIfDeferred();
                if (!current()) return failed("view-closed");
                if (!allowed()) return failed("file-denied");
                if (leaf.view instanceof FileView && leaf.view.getViewType() === "canvas" && leaf.view.file === file) {
                    await this.options.app.workspace.revealLeaf(leaf);
                    return { phase: "opened" };
                }
            }
            if (!current()) return failed("view-closed");
            const leaf = this.options.app.workspace.getLeaf("tab");
            await leaf.openFile(file, { active: false });
            if (!current()) return failed("view-closed");
            if (!allowed()) return failed("file-denied");
            if (!(leaf.view instanceof FileView) || leaf.view.getViewType() !== "canvas" || leaf.view.file !== file) {
                return failed("native-unavailable");
            }
            await this.options.app.workspace.revealLeaf(leaf);
            return { phase: "opened" };
        } catch (error) {
            this.options.log("Canvas open failed", error);
            return failed("open-failed");
        }
    }
}
