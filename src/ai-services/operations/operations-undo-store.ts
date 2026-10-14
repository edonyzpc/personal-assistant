import { getPlatformCrypto } from "../../platform-dom";
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
    move?: UndoReceipt["move"];
    resource?: UndoReceipt["resource"];
}

export interface OperationsUndoStoreOptions {
    now?: () => number;
    ttlMs?: number;
    createId?: () => string;
}

export class OperationsUndoStore {
    private readonly receipts = new Map<string, UndoReceipt>();
    private readonly used = new Set<string>();
    private readonly expired = new Set<string>();
    private readonly leased = new Set<string>();
    private readonly retiredLeases = new Set<string>();
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
            ...(input.move ? { move: Object.freeze({ ...input.move }) } : {}),
            ...(input.resource ? { resource: input.resource } : {}),
            createdAt,
            expiresAt: createdAt + this.ttlMs,
        });
        this.receipts.set(receipt.id, receipt);
        return receipt;
    }

    get(id: string): UndoReceiptLookup {
        if (this.used.has(id)) return { ok: false, reason: "used" };
        if (this.expired.has(id)) return { ok: false, reason: "expired" };
        const receipt = this.receipts.get(id);
        if (!receipt) return { ok: false, reason: "missing" };
        if (receipt.expiresAt <= this.now() && !this.leased.has(id)) {
            this.releaseResource(id);
            this.expired.add(id);
            return { ok: false, reason: "expired" };
        }
        return { ok: true, receipt };
    }

    markUsed(id: string): void {
        if (!this.receipts.has(id)) return;
        this.releaseResource(id);
        this.used.add(id);
    }

    remove(id: string): void {
        this.releaseResource(id);
    }

    acquire(id: string): boolean {
        if (this.leased.has(id) || !this.get(id).ok) return false;
        this.leased.add(id); return true;
    }
    releaseLease(id: string): void {
        this.leased.delete(id);
        if (this.retiredLeases.delete(id)) this.releaseResource(id);
        this.pruneExpired();
    }
    private releaseResource(id: string): void {
        const receipt = this.receipts.get(id);
        if (receipt?.resource?.action === "trash") receipt.resource.release();
        this.receipts.delete(id);
    }

    listAvailable(): UndoReceipt[] {
        this.pruneExpired();
        return [...this.receipts.values()];
    }

    clear(): void {
        for (const id of this.receipts.keys()) {
            if (this.leased.has(id)) this.retiredLeases.add(id);
            else this.releaseResource(id);
        }
        this.used.clear();
        this.expired.clear();
    }

    private pruneExpired(): void {
        const now = this.now();
        for (const [id, receipt] of this.receipts) {
            if (receipt.expiresAt <= now && !this.leased.has(id)) {
                this.releaseResource(id);
                this.expired.add(id);
            }
        }
    }
}

function defaultId(): string {
    return getPlatformCrypto()?.randomUUID?.() ?? `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
