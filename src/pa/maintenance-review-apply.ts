import { validateTargetConfinement } from "../ai-services/write-action-framework/target-confinement";
import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type PersistedSourceRef,
} from "./contracts";
import type { MaintenanceProposal } from "./maintenance-review";

export type MaintenanceMoveActionStatus = "applied" | "undone";

export interface MaintenanceMoveActionLogEntry {
    id: string;
    proposalId: string;
    reviewQueueItemId?: string;
    actionType: "move";
    status: MaintenanceMoveActionStatus;
    oldPath: string;
    newPath: string;
    appliedAt: string;
    undoneAt?: string;
    sourceRefs: PersistedSourceRef[];
    dataBoundarySnapshotId: string;
    undoStrategy: "move_back";
}

export interface MaintenanceMoveApplyHost {
    exists(path: string): Promise<boolean>;
    rename(oldPath: string, newPath: string): Promise<void>;
    isPathAllowed(path: string): boolean;
    now(): Date;
    idFactory(): string;
}

export type MaintenanceMoveApplyResult =
    | { ok: true; action: MaintenanceMoveActionLogEntry; message: string }
    | { ok: false; reason: string; message: string };

export type MaintenanceMoveUndoResult =
    | { ok: true; action: MaintenanceMoveActionLogEntry; message: string }
    | { ok: false; reason: string; message: string };

const GENERATED_NOTE_ROOTS = [".pagelet", "pagelet-generated"] as const;

function normalizeVaultPath(path: string | undefined): string {
    return String(path ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function parentFolder(path: string): string {
    const normalized = normalizeVaultPath(path);
    const slash = normalized.lastIndexOf("/");
    return slash > 0 ? normalized.slice(0, slash) : "";
}

function targetAllowedRoots(path: string): string[] {
    const folder = parentFolder(path);
    return [folder.length > 0 ? folder : normalizeVaultPath(path)];
}

function targetAllowedRootsForProposal(proposal: MaintenanceProposal, oldPath: string, newPath: string): string[] {
    if (proposal.category === "inbox_cleanup") return ["Notes"];
    const declaredTarget = normalizeVaultPath(proposal.undoMetadata.newPath ?? proposal.preview.affectedPaths.find((path) =>
        normalizeVaultPath(path) !== oldPath));
    if (declaredTarget && declaredTarget === newPath) return targetAllowedRoots(newPath);
    return targetAllowedRoots(oldPath);
}

function validateMovePaths(oldPath: string | undefined, newPath: string | undefined): MaintenanceMoveApplyResult | null {
    if (!oldPath || !newPath) {
        return { ok: false, reason: "missing_paths", message: "Move proposal is missing the source or target path." };
    }
    if (normalizeVaultPath(oldPath) === normalizeVaultPath(newPath)) {
        return { ok: false, reason: "same_path", message: "Move proposal source and target paths are the same." };
    }
    if (!normalizeVaultPath(oldPath).toLowerCase().endsWith(".md")) {
        return { ok: false, reason: "invalid_source_bad_extension", message: "Source path must be a Markdown note." };
    }
    const sourceValidation = validateSourceRefPathShape({ path: oldPath });
    if (!sourceValidation.ok) {
        return {
            ok: false,
            reason: `invalid_source_${sourceValidation.reason}`,
            message: `Source path is not allowed: ${sourceValidation.reason}.`,
        };
    }
    const targetValidation = validateSourceRefPathShape({ path: newPath });
    if (!targetValidation.ok) {
        return {
            ok: false,
            reason: `invalid_target_${targetValidation.reason}`,
            message: `Target path is not allowed: ${targetValidation.reason}.`,
        };
    }
    return null;
}

function hasSourceRefForPath(proposal: MaintenanceProposal, oldPath: string): boolean {
    return proposal.sourceRefs.some((ref) =>
        normalizeVaultPath(ref.path) === oldPath && validateSourceRefPathShape(ref).ok);
}

function validateActionLogEntry(entry: MaintenanceMoveActionLogEntry): boolean {
    if (entry.actionType !== "move") return false;
    if (entry.status !== "applied" && entry.status !== "undone") return false;
    if (!entry.id || !entry.proposalId || !entry.oldPath || !entry.newPath || !entry.appliedAt) return false;
    if (entry.undoStrategy !== "move_back") return false;
    if (!Array.isArray(entry.sourceRefs) || entry.sourceRefs.length === 0) return false;
    if (hasForbiddenPersistedTextFields(entry)) return false;
    return validateSourceRefPathShape({ path: entry.oldPath }).ok
        && validateSourceRefPathShape({ path: entry.newPath }).ok
        && entry.sourceRefs.every((ref) => validateSourceRefPathShape(ref).ok);
}

export function normalizeMaintenanceMoveActionLog(value: unknown): MaintenanceMoveActionLogEntry[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry): entry is MaintenanceMoveActionLogEntry => (
            typeof entry === "object"
            && entry !== null
            && validateActionLogEntry(entry as MaintenanceMoveActionLogEntry)
        ))
        .map((entry) => ({
            ...entry,
            sourceRefs: entry.sourceRefs.map((ref) => ({
                ...ref,
                whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
            })),
        }));
}

export function findMaintenanceActionLogEntry(
    entries: readonly MaintenanceMoveActionLogEntry[],
    id: string,
): MaintenanceMoveActionLogEntry | null {
    return entries.find((entry) => entry.id === id) ?? null;
}

export async function applyMaintenanceMoveProposal(
    proposal: MaintenanceProposal,
    host: MaintenanceMoveApplyHost,
    options: { reviewQueueItemId?: string } = {},
): Promise<MaintenanceMoveApplyResult> {
    if (proposal.actionType !== "move") {
        return { ok: false, reason: "unsupported_action", message: "Only move proposals can be applied in this version." };
    }

    const oldPath = normalizeVaultPath(proposal.preview.oldPath ?? proposal.preview.sourcePath);
    const newPath = normalizeVaultPath(proposal.preview.newPath);
    const pathError = validateMovePaths(oldPath, newPath);
    if (pathError) return pathError;
    if (!hasSourceRefForPath(proposal, oldPath)) {
        return {
            ok: false,
            reason: "missing_source_ref",
            message: "Move proposal is missing source-backed evidence for the source note.",
        };
    }

    const confinement = await validateTargetConfinement(newPath, {
        allowedRoots: targetAllowedRootsForProposal(proposal, oldPath, newPath),
        allowedExtensions: [".md"],
        forbiddenRoots: GENERATED_NOTE_ROOTS,
        maxPathLength: 400,
    }, {
        exists: (path) => host.exists(path),
    });
    if (!confinement.ok) {
        return {
            ok: false,
            reason: `target_${confinement.reason}`,
            message: `Target path is not allowed: ${confinement.reason}.`,
        };
    }

    if (!host.isPathAllowed(oldPath)) {
        return { ok: false, reason: "source_denied", message: "The source note is outside the current Data Boundary." };
    }
    if (!host.isPathAllowed(newPath)) {
        return { ok: false, reason: "target_denied", message: "The target path is outside the current Data Boundary." };
    }

    const sourceExists = await host.exists(oldPath);
    if (!sourceExists) {
        return { ok: false, reason: "source_missing", message: "The source note no longer exists. Re-run Maintenance Review." };
    }
    const targetExists = await host.exists(newPath);
    if (targetExists) {
        return { ok: false, reason: "target_exists", message: "The target path already exists. Re-run Maintenance Review." };
    }

    try {
        await host.rename(oldPath, newPath);
    } catch {
        return { ok: false, reason: "rename_failed", message: "Move failed while renaming the note. Re-run Maintenance Review." };
    }

    const action: MaintenanceMoveActionLogEntry = {
        id: host.idFactory(),
        proposalId: proposal.id,
        actionType: "move",
        status: "applied",
        oldPath,
        newPath,
        appliedAt: host.now().toISOString(),
        sourceRefs: proposal.sourceRefs.map((ref) => ({
            ...ref,
            whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
        })),
        dataBoundarySnapshotId: proposal.dataBoundarySnapshotId,
        undoStrategy: "move_back",
    };
    if (options.reviewQueueItemId) action.reviewQueueItemId = options.reviewQueueItemId;

    return { ok: true, action, message: `Moved ${oldPath} to ${newPath}.` };
}

export async function undoMaintenanceMoveAction(
    entry: MaintenanceMoveActionLogEntry,
    host: MaintenanceMoveApplyHost,
): Promise<MaintenanceMoveUndoResult> {
    if (entry.actionType !== "move") {
        return { ok: false, reason: "unsupported_action", message: "Only move actions can be undone in this version." };
    }
    if (entry.status !== "applied") {
        return { ok: false, reason: "not_applied", message: "This move has already been undone or is not active." };
    }

    const oldPath = normalizeVaultPath(entry.oldPath);
    const newPath = normalizeVaultPath(entry.newPath);
    const pathError = validateMovePaths(newPath, oldPath);
    if (pathError) return pathError;

    const confinement = await validateTargetConfinement(oldPath, {
        allowedRoots: targetAllowedRoots(oldPath),
        allowedExtensions: [".md"],
        forbiddenRoots: GENERATED_NOTE_ROOTS,
        maxPathLength: 400,
    }, {
        exists: (path) => host.exists(path),
    });
    if (!confinement.ok) {
        return {
            ok: false,
            reason: `target_${confinement.reason}`,
            message: `Undo target path is not allowed: ${confinement.reason}.`,
        };
    }
    if (!host.isPathAllowed(newPath) || !host.isPathAllowed(oldPath)) {
        return { ok: false, reason: "boundary_denied", message: "The move can no longer be undone inside the current Data Boundary." };
    }
    if (!(await host.exists(newPath))) {
        return { ok: false, reason: "moved_note_missing", message: "The moved note no longer exists at the recovery path." };
    }
    if (await host.exists(oldPath)) {
        return { ok: false, reason: "restore_target_exists", message: "The original path is occupied. Undo was not applied." };
    }

    try {
        await host.rename(newPath, oldPath);
    } catch {
        return { ok: false, reason: "rename_failed", message: "Undo failed while moving the note back. Please inspect the note location." };
    }

    return {
        ok: true,
        action: {
            ...entry,
            status: "undone",
            undoneAt: host.now().toISOString(),
            sourceRefs: entry.sourceRefs.map((ref) => ({
                ...ref,
                whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
            })),
        },
        message: `Moved ${newPath} back to ${oldPath}.`,
    };
}
