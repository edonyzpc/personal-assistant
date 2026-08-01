import type {
    OperationsAuditRecord,
    OperationsAuditWriteInput,
    OperationsVault,
} from "./types";

export const OPERATIONS_AUDIT_DIRECTORY = ".obsidian/plugins/personal-assistant/audit";

export interface OperationsAuditStoreOptions {
    includeContent?: boolean | (() => boolean);
    retentionDays?: 30 | 90 | (() => 30 | 90);
    now?: () => number;
    directory?: string;
}

export interface AuditWriteResult {
    ok: boolean;
    path?: string;
    error?: string;
    /** Cleanup failed; the current record write result is still reported independently. */
    retentionWarning?: string;
}

export interface AuditCleanupResult {
    attempted: boolean;
    deleted: number;
    error?: string;
}

/** Production audit only. Undo snapshots are owned by OperationsUndoStore. */
export class OperationsAuditStore {
    private readonly includeContent: () => boolean;
    private readonly retentionDays: () => 30 | 90;
    private readonly now: () => number;
    private readonly directory: string;
    private cleanupAttempted = false;
    private sequence = 0;

    constructor(
        private readonly vault: Pick<OperationsVault, "adapter">,
        options: OperationsAuditStoreOptions = {},
    ) {
        this.includeContent = typeof options.includeContent === "function"
            ? options.includeContent
            : () => options.includeContent === true;
        this.retentionDays = typeof options.retentionDays === "function"
            ? options.retentionDays
            : () => options.retentionDays === 90 ? 90 : 30;
        this.now = options.now ?? Date.now;
        this.directory = options.directory ?? OPERATIONS_AUDIT_DIRECTORY;
    }

    async write(input: OperationsAuditWriteInput): Promise<AuditWriteResult> {
        const adapter = this.vault.adapter;
        if (!adapter.write) return { ok: false, error: "Audit storage is unavailable." };
        const cleanup = await this.cleanupOnce();
        const retentionWarning = cleanup.error;
        try {
            await this.ensureDirectory();
            const record = this.toRecord(input);
            const path = await this.nextUniquePath(record.completedAt, record.operationId);
            await adapter.write(path, JSON.stringify(record, null, 2));
            return { ok: true, path, ...(retentionWarning ? { retentionWarning } : {}) };
        } catch (error) {
            return {
                ok: false,
                error: safeError(error, "Audit record could not be written."),
                ...(retentionWarning ? { retentionWarning } : {}),
            };
        }
    }

    async cleanupOnce(): Promise<AuditCleanupResult> {
        if (this.cleanupAttempted) return { attempted: false, deleted: 0 };
        this.cleanupAttempted = true;
        const adapter = this.vault.adapter;
        if (!adapter.list || !adapter.read || !adapter.remove) {
            return {
                attempted: true,
                deleted: 0,
                error: "Audit retention cleanup is unavailable.",
            };
        }
        try {
            if (!(await adapter.exists(this.directory))) return { attempted: true, deleted: 0 };
            const listing = await adapter.list(this.directory);
            const cutoff = this.now() - this.retentionDays() * 24 * 60 * 60 * 1_000;
            let deleted = 0;
            for (const path of listing.files) {
                if (!isDirectAuditJson(path, this.directory)) continue;
                const completedAt = await readOwnedAuditTimestamp(adapter.read, path);
                if (completedAt !== null && completedAt < cutoff) {
                    await adapter.remove(path);
                    deleted += 1;
                }
            }
            return { attempted: true, deleted };
        } catch (error) {
            return { attempted: true, deleted: 0, error: safeError(error, "Audit cleanup failed.") };
        }
    }

    private toRecord(input: OperationsAuditWriteInput): OperationsAuditRecord {
        const contentFree = {
            version: 1 as const,
            operationId: input.operationId,
            intentId: input.intentId,
            tool: input.tool,
            targetPath: input.targetPath,
            status: input.status,
            startedAt: input.startedAt,
            completedAt: input.completedAt,
            ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
        };
        if (!this.includeContent()) return contentFree;
        return {
            ...contentFree,
            before: input.before ?? null,
            after: input.after ?? null,
        };
    }

    private async ensureDirectory(): Promise<void> {
        const adapter = this.vault.adapter;
        if (await adapter.exists(this.directory)) return;
        if (!adapter.mkdir) throw new Error("Audit directory creation is unavailable.");
        const segments = this.directory.split("/");
        let current = "";
        for (const segment of segments) {
            current = current ? `${current}/${segment}` : segment;
            if (!(await adapter.exists(current))) await adapter.mkdir(current);
        }
    }

    private async nextUniquePath(completedAt: string, operationId: string): Promise<string> {
        for (let attempt = 0; attempt < 1_000; attempt += 1) {
            const path = `${this.directory}/${auditFilename(completedAt, operationId, this.sequence++)}`;
            if (!(await this.vault.adapter.exists(path))) return path;
        }
        throw new Error("Could not allocate a unique audit filename.");
    }
}

function auditFilename(completedAt: string, operationId: string, sequence: number): string {
    const timestamp = completedAt.replace(/:/g, "-").replace(/[^0-9TZ.-]/g, "_");
    const safeId = operationId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "operation";
    return `${timestamp}_${safeId}_${sequence.toString(36)}.json`;
}

function isDirectAuditJson(path: string, directory: string): boolean {
    if (!path.startsWith(`${directory}/`) || !path.endsWith(".json")) return false;
    return !path.slice(directory.length + 1).includes("/");
}

async function readOwnedAuditTimestamp(
    read: (path: string) => Promise<string>,
    path: string,
): Promise<number | null> {
    try {
        const parsed = JSON.parse(await read(path)) as Record<string, unknown>;
        if (parsed.version !== 1 || typeof parsed.operationId !== "string" || typeof parsed.completedAt !== "string") {
            return null;
        }
        const timestamp = Date.parse(parsed.completedAt);
        return Number.isFinite(timestamp) ? timestamp : null;
    } catch {
        return null;
    }
}

function safeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}
