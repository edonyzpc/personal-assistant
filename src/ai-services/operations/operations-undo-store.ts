import type { CoreWriteToolName, UndoReceipt } from "./types";

export const DEFAULT_UNDO_TTL_MS = 30 * 60 * 1_000;

export type UndoReceiptLookup =
    | { ok: true; receipt: UndoReceipt }
    | { ok: false; reason: "missing" | "expired" | "used" };

export interface CreateUndoReceiptInput {
    id?: string;
    intentId: string;
    operationId: string;
    path: string;
    kind: CoreWriteToolName;
    before: string | null;
    expectedAfter: string;
}

export interface OperationsUndoStoreOptions {
    now?: () => number;
    ttlMs?: number;
    createId?: () => string;
}

export class OperationsUndoStore {
    private readonly receipts = new Map<string, UndoReceipt>();
    private readonly used = new Set<string>();
    private readonly now: () => number;
    private readonly ttlMs: number;
    private readonly createId: () => string;

    constructor(options: OperationsUndoStoreOptions = {}) {
        this.now = options.now ?? Date.now;
        this.ttlMs = options.ttlMs ?? DEFAULT_UNDO_TTL_MS;
        this.createId = options.createId ?? defaultId;
    }

    create(input: CreateUndoReceiptInput): UndoReceipt {
        this.pruneExpired();
        const createdAt = this.now();
        const receipt = Object.freeze({
            id: input.id ?? this.createId(),
            intentId: input.intentId,
            operationId: input.operationId,
            path: input.path,
            kind: input.kind,
            before: input.before,
            expectedAfter: input.expectedAfter,
            createdAt,
            expiresAt: createdAt + this.ttlMs,
        });
        this.receipts.set(receipt.id, receipt);
        return receipt;
    }

    get(id: string): UndoReceiptLookup {
        if (this.used.has(id)) return { ok: false, reason: "used" };
        const receipt = this.receipts.get(id);
        if (!receipt) return { ok: false, reason: "missing" };
        if (receipt.expiresAt <= this.now()) {
            this.receipts.delete(id);
            return { ok: false, reason: "expired" };
        }
        return { ok: true, receipt };
    }

    markUsed(id: string): void {
        if (!this.receipts.has(id)) return;
        this.receipts.delete(id);
        this.used.add(id);
    }

    remove(id: string): void {
        this.receipts.delete(id);
    }

    listAvailable(): UndoReceipt[] {
        this.pruneExpired();
        return [...this.receipts.values()];
    }

    clear(): void {
        this.receipts.clear();
        this.used.clear();
    }

    private pruneExpired(): void {
        const now = this.now();
        for (const [id, receipt] of this.receipts) {
            if (receipt.expiresAt <= now) this.receipts.delete(id);
        }
    }
}

function defaultId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
