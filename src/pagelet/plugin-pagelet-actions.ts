import { Notice, normalizePath, TFile } from "obsidian";

import {
    decideDataBoundaryForSource,
    scanMaintenanceReview,
    applyMaintenanceMoveProposal,
    findMaintenanceActionLogEntry,
    maintenanceProposalToReviewQueueInput,
    undoMaintenanceMoveAction,
    type MaintenanceMoveActionLogEntry,
    type MaintenanceMoveApplyResult,
    type MaintenanceMoveUndoResult,
    type MaintenanceProposal,
    type MaintenanceReviewNote,
    type MaintenanceReviewRunResult,
    type ReviewQueueCreateInput,
    type ReviewQueueItem,
    type ReviewQueueResult,
    type ReviewQueueStatus,
} from "../pa";
import { pageletT } from "../locales/pagelet";
import type { GeneratedReviewNote, WriteResult } from "./index";

export interface PageletActionSettingsSnapshot {
    dataBoundary: Parameters<typeof decideDataBoundaryForSource>[1];
    quickCaptureInboxPath: string;
    maintenanceActionLog: MaintenanceMoveActionLogEntry[];
}

export interface PageletActionPluginIntegrationDependencies {
    getLocale(): "zh" | "en";
    getSettings(): PageletActionSettingsSnapshot;
    collectMaintenanceReviewFiles(options: {
        scopePaths?: readonly string[];
        maxFiles?: number;
        includeWholeVault?: boolean;
    }): TFile[];
    readCached(file: TFile): Promise<string>;
    getDataBoundaryTags(file: TFile): string[];
    isGeneratedDataBoundaryFile(file: TFile): boolean;
    createReviewQueueItem(input: ReviewQueueCreateInput): Promise<ReviewQueueResult<ReviewQueueItem>>;
    confirm(input: {
        title: string;
        message: string;
        confirmText: string;
    }): Promise<boolean>;
    findMaintenanceQueueItem(proposalId: string): ReviewQueueItem | null;
    exists(path: string): Promise<boolean>;
    rename(from: string, to: string): Promise<void>;
    getFile(path: string): TFile | null;
    isMaintenanceMovePathAllowed(path: string): boolean;
    now(): Date;
    idFactory(): string;
    appendMaintenanceActionLog(action: MaintenanceMoveActionLogEntry): Promise<void>;
    replaceMaintenanceActionLog(action: MaintenanceMoveActionLogEntry): Promise<void>;
    updateMaintenanceQueueStatus(id: string, status: ReviewQueueStatus): Promise<void>;
    mintNonCollidingPageletPath(basePath: string): Promise<string>;
    captureReviewNoteWriter(): ((options: {
        generatedNote: GeneratedReviewNote;
        targetPath: string;
    }) => Promise<
        | { status: "ok"; observation: { createdPath?: unknown } }
        | { status: "error"; userSafeMessage?: string; error?: string }
    >) | null;
    log(message: string, detail?: unknown): void;
}

export class PageletActionPluginIntegration {
    constructor(private readonly dependencies: PageletActionPluginIntegrationDependencies) {}

    async runMaintenanceReview(options: {
        enqueueProposals?: boolean;
        scopePaths?: readonly string[];
        maxFiles?: number;
        maxProposalsPerCategory?: number;
        includeWholeVault?: boolean;
    } = {}): Promise<MaintenanceReviewRunResult> {
        const notes: MaintenanceReviewNote[] = [];
        for (const file of this.dependencies.collectMaintenanceReviewFiles(options)) {
            const settings = this.dependencies.getSettings();
            const decision = decideDataBoundaryForSource(
                {
                    path: file.path,
                    tags: this.dependencies.getDataBoundaryTags(file),
                    isGenerated: this.dependencies.isGeneratedDataBoundaryFile(file),
                },
                settings.dataBoundary,
            );
            if (decision.decision !== "allow") continue;
            try {
                notes.push({
                    path: file.path,
                    basename: file.basename,
                    content: await this.dependencies.readCached(file),
                    dataBoundarySnapshotId: `data_boundary:${decision.reason}`,
                });
            } catch (error) {
                this.dependencies.log("Failed to read note for Maintenance Review", {
                    path: file.path,
                    error,
                });
            }
        }

        const quickCaptureInboxPath = normalizePath(
            this.dependencies.getSettings().quickCaptureInboxPath ?? "",
        ).replace(/^\.\//, "");
        const inboxFolderSlash = quickCaptureInboxPath.lastIndexOf("/");
        const quickCaptureInboxFolder = inboxFolderSlash > 0
            ? quickCaptureInboxPath.slice(0, inboxFolderSlash)
            : "";
        const result = scanMaintenanceReview(notes, {
            inboxFolders: quickCaptureInboxFolder ? [quickCaptureInboxFolder] : [],
            scopePaths: options.scopePaths,
            maxProposalsPerCategory: options.maxProposalsPerCategory,
        });

        if (options.enqueueProposals === true) {
            for (const proposal of result.proposals) {
                const queueResult = await this.dependencies.createReviewQueueItem(
                    maintenanceProposalToReviewQueueInput(proposal, {
                        admissionReason: "maintenance_action_ready",
                    }),
                );
                if (!queueResult.ok) {
                    this.dependencies.log("Failed to enqueue Maintenance Review proposal", {
                        id: proposal.id,
                        reason: queueResult.reason,
                    });
                }
            }
        }
        return result;
    }

    async applyMaintenanceProposal(proposal: MaintenanceProposal): Promise<MaintenanceMoveApplyResult> {
        if (proposal.actionType !== "move") {
            return {
                ok: false,
                reason: "unsupported_action",
                message: pageletT("pagelet.maintenance.apply.unsupported", this.dependencies.getLocale()),
            };
        }
        const oldPath = proposal.preview.oldPath ?? proposal.preview.sourcePath;
        const newPath = proposal.preview.newPath;
        const confirmed = await this.dependencies.confirm({
            title: pageletT("pagelet.maintenance.apply.confirmTitle", this.dependencies.getLocale()),
            message: pageletT("pagelet.maintenance.apply.confirmMessage", this.dependencies.getLocale(), {
                oldPath: oldPath ?? "",
                newPath: newPath ?? "",
            }),
            confirmText: pageletT("pagelet.maintenance.apply.confirm", this.dependencies.getLocale()),
        });
        if (!confirmed) {
            return {
                ok: false,
                reason: "cancelled",
                message: pageletT("pagelet.maintenance.apply.cancelled", this.dependencies.getLocale()),
            };
        }

        const queueItem = this.dependencies.findMaintenanceQueueItem(proposal.id);
        const result = await applyMaintenanceMoveProposal(proposal, {
            exists: this.dependencies.exists,
            rename: this.dependencies.rename,
            isPathAllowed: (path) => this.dependencies.isMaintenanceMovePathAllowed(path),
            now: () => this.dependencies.now(),
            idFactory: this.dependencies.idFactory,
        }, {
            reviewQueueItemId: queueItem?.id,
        });

        if (!result.ok) {
            new Notice(result.message, 5000);
            return result;
        }

        try {
            await this.dependencies.appendMaintenanceActionLog(result.action);
        } catch (error) {
            this.dependencies.log("Maintenance apply persistence failed after rename; attempting rollback", error);
            const rollback = await this.rollbackAppliedMaintenanceMove(result.action)
                .catch((rollbackError) => {
                    this.dependencies.log("Maintenance apply rollback failed", rollbackError);
                    return false;
                });
            const message = rollback
                ? "Move was rolled back because PA could not save the action log. Please try again."
                : "Move succeeded, but PA could not save the action log or roll it back. Please inspect the note location before continuing.";
            new Notice(message, 8000);
            return { ok: false, reason: "action_log_persist_failed", message };
        }
        if (queueItem) await this.dependencies.updateMaintenanceQueueStatus(queueItem.id, "applied");
        new Notice(result.message, 5000);
        return result;
    }

    async undoMaintenanceMove(actionId: string): Promise<MaintenanceMoveUndoResult> {
        const entry = findMaintenanceActionLogEntry(
            this.dependencies.getSettings().maintenanceActionLog ?? [],
            actionId,
        );
        if (!entry) {
            return {
                ok: false,
                reason: "not_found",
                message: pageletT("pagelet.maintenance.undo.notFound", this.dependencies.getLocale()),
            };
        }
        const confirmed = await this.dependencies.confirm({
            title: pageletT("pagelet.maintenance.undo.confirmTitle", this.dependencies.getLocale()),
            message: pageletT("pagelet.maintenance.undo.confirmMessage", this.dependencies.getLocale(), {
                oldPath: entry.oldPath,
                newPath: entry.newPath,
            }),
            confirmText: pageletT("pagelet.maintenance.undo.confirm", this.dependencies.getLocale()),
        });
        if (!confirmed) {
            return {
                ok: false,
                reason: "cancelled",
                message: pageletT("pagelet.maintenance.undo.cancelled", this.dependencies.getLocale()),
            };
        }

        const result = await undoMaintenanceMoveAction(entry, {
            exists: this.dependencies.exists,
            rename: this.dependencies.rename,
            isPathAllowed: (path) => this.dependencies.isMaintenanceMovePathAllowed(path),
            now: () => this.dependencies.now(),
            idFactory: this.dependencies.idFactory,
        });

        if (!result.ok) {
            new Notice(result.message, 5000);
            return result;
        }
        try {
            await this.dependencies.replaceMaintenanceActionLog(result.action);
        } catch (error) {
            this.dependencies.log("Maintenance undo persistence failed after move; attempting rollback", error);
            const rollback = await this.rollbackUndoneMaintenanceMove(entry)
                .catch((rollbackError) => {
                    this.dependencies.log("Maintenance undo rollback failed", rollbackError);
                    return false;
                });
            const message = rollback
                ? "Undo was rolled back because PA could not save the action log. Please try again."
                : "Undo moved the note back, but PA could not save the action log or roll it back. Please inspect the note location before continuing.";
            new Notice(message, 8000);
            return { ok: false, reason: "action_log_persist_failed", message };
        }
        if (entry.reviewQueueItemId) {
            await this.dependencies.updateMaintenanceQueueStatus(entry.reviewQueueItemId, "undone");
        }
        new Notice(result.message, 5000);
        return result;
    }

    async writeReviewNote(note: GeneratedReviewNote): Promise<WriteResult> {
        const writeWithCapturedRuntime = this.dependencies.captureReviewNoteWriter();
        if (!writeWithCapturedRuntime) {
            return { success: false, error: "Pagelet write runtime is unavailable." };
        }
        const targetPath = await this.dependencies.mintNonCollidingPageletPath(note.targetPath);
        const lastSlash = targetPath.lastIndexOf("/");
        const targetFolder = lastSlash >= 0 ? targetPath.slice(0, lastSlash) : "";
        const fileName = lastSlash >= 0 ? targetPath.slice(lastSlash + 1) : targetPath;
        const generatedNote: GeneratedReviewNote = {
            ...note,
            targetPath,
            targetFolder,
            fileName,
        };
        const result = await writeWithCapturedRuntime({
            generatedNote,
            targetPath,
        });
        if (result.status === "ok") {
            return {
                success: true,
                filePath: typeof result.observation?.createdPath === "string"
                    ? result.observation.createdPath
                    : targetPath,
            };
        }
        return {
            success: false,
            error: result.userSafeMessage ?? result.error ?? "Pagelet write failed.",
        };
    }

    private normalizeFile(path: string): TFile | null {
        const file = this.dependencies.getFile(normalizePath(path).replace(/^\.\//, ""));
        return file instanceof TFile ? file : null;
    }

    private async rollbackAppliedMaintenanceMove(action: MaintenanceMoveActionLogEntry): Promise<boolean> {
        const currentPath = normalizePath(action.newPath).replace(/^\.\//, "");
        const originalPath = normalizePath(action.oldPath).replace(/^\.\//, "");
        const currentFile = this.normalizeFile(currentPath);
        if (!currentFile) return false;
        if (await this.dependencies.exists(originalPath)) return false;
        await this.dependencies.rename(currentPath, originalPath);
        return true;
    }

    private async rollbackUndoneMaintenanceMove(action: MaintenanceMoveActionLogEntry): Promise<boolean> {
        const originalPath = normalizePath(action.oldPath).replace(/^\.\//, "");
        const movedPath = normalizePath(action.newPath).replace(/^\.\//, "");
        const originalFile = this.normalizeFile(originalPath);
        if (!originalFile) return false;
        if (await this.dependencies.exists(movedPath)) return false;
        await this.dependencies.rename(originalPath, movedPath);
        return true;
    }
}
