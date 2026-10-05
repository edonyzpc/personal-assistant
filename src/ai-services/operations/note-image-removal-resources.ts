import type { NoteImageRemovalAttachmentFile } from "./note-image-removal";

export const NOTE_IMAGE_REMOVAL_MAX_RECOVERY_BYTES = 64 * 1024 * 1024;

export interface NoteImageRemovalReservation {
    readonly id: string;
    readonly byteLength: number;
    release(): void;
}

export interface NoteImageRemovalSnapshot {
    readonly receiptId: string;
    readonly bytes: ArrayBuffer;
    readonly contentHash: string;
    readonly attachment: NoteImageRemovalAttachmentFile;
    readonly expiresAt: number;
}

interface RetainedSnapshot extends NoteImageRemovalSnapshot {
    timer: ReturnType<typeof setTimeout>;
    leased: number;
    expiredPending: boolean;
}

export type NoteImageRemovalResourceErrorCode =
    | "capacity_exceeded"
    | "missing"
    | "expired"
    | "busy";

export class NoteImageRemovalResourceError extends Error {
    constructor(
        readonly code: NoteImageRemovalResourceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "NoteImageRemovalResourceError";
    }
}

/** Shared process-local recovery budget. It never serializes bytes or authority. */
export class NoteImageRemovalResourceOwner {
    private readonly reservations = new Map<string, number>();
    private readonly snapshots = new Map<string, RetainedSnapshot>();
    private disposed = false;
    private readonly now: () => number;

    constructor(options: { now?: () => number } = {}) {
        this.now = options.now ?? Date.now;
    }

    reserve(byteLength: number, createId: () => string): NoteImageRemovalReservation {
        this.assertUsable();
        if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
            throw new NoteImageRemovalResourceError("capacity_exceeded", "Invalid attachment recovery size.");
        }
        if (byteLength > NOTE_IMAGE_REMOVAL_MAX_RECOVERY_BYTES
            || this.usedBytes() + byteLength > NOTE_IMAGE_REMOVAL_MAX_RECOVERY_BYTES) {
            throw new NoteImageRemovalResourceError(
                "capacity_exceeded",
                "Temporary image recovery capacity is full.",
            );
        }
        const id = createId();
        this.reservations.set(id, byteLength);
        let released = false;
        return Object.freeze({
            id,
            byteLength,
            release: () => {
                if (released) return;
                released = true;
                this.reservations.delete(id);
            },
        });
    }

    retain(
        reservation: NoteImageRemovalReservation,
        input: {
            receiptId: string;
            bytes: ArrayBuffer;
            contentHash: string;
            attachment: NoteImageRemovalAttachmentFile;
            expiresAt: number;
        },
    ): NoteImageRemovalSnapshot {
        this.assertUsable();
        if (!this.reservations.has(reservation.id)
            || this.reservations.get(reservation.id) !== reservation.byteLength
            || input.bytes.byteLength !== reservation.byteLength) {
            throw new NoteImageRemovalResourceError("missing", "The recovery reservation no longer matches its snapshot.");
        }
        const existing = this.snapshots.get(input.receiptId);
        if (existing) throw new NoteImageRemovalResourceError("busy", "Recovery snapshot already exists.");
        const retained: RetainedSnapshot = {
            ...input,
            bytes: input.bytes,
            timer: setTimeout(() => this.expire(input.receiptId), Math.max(0, input.expiresAt - this.now())),
            leased: 0,
            expiredPending: false,
        };
        this.reservations.delete(reservation.id);
        this.snapshots.set(input.receiptId, retained);
        return retained;
    }

    acquire(receiptId: string): NoteImageRemovalSnapshot {
        this.assertUsable();
        const snapshot = this.snapshots.get(receiptId);
        if (!snapshot) throw new NoteImageRemovalResourceError("missing", "The temporary recovery snapshot is unavailable.");
        if (snapshot.leased > 0) throw new NoteImageRemovalResourceError("busy", "The temporary recovery snapshot is already in use.");
        snapshot.leased += 1;
        return snapshot;
    }

    releaseLease(receiptId: string): void {
        const snapshot = this.snapshots.get(receiptId);
        if (!snapshot || snapshot.leased <= 0) return;
        snapshot.leased -= 1;
        if (snapshot.leased === 0 && (snapshot.expiredPending || this.disposed)) this.removeSnapshot(receiptId);
    }

    release(receiptId: string): void {
        this.removeSnapshot(receiptId);
    }

    retire(receiptId: string): void {
        const snapshot = this.snapshots.get(receiptId);
        if (!snapshot) return;
        if (snapshot.leased > 0) {
            snapshot.expiredPending = true;
            return;
        }
        this.removeSnapshot(receiptId);
    }

    has(receiptId: string): boolean {
        return this.snapshots.has(receiptId);
    }

    usedBytes(): number {
        if (this.disposed) return 0;
        return [...this.reservations.values()].reduce((total, size) => total + size, 0)
            + [...this.snapshots.values()].reduce((total, snapshot) => total + snapshot.bytes.byteLength, 0);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const snapshot of this.snapshots.values()) {
            if (snapshot.leased > 0) snapshot.expiredPending = true;
            else this.removeSnapshot(snapshot.receiptId);
        }
        this.reservations.clear();
    }

    private expire(receiptId: string): void {
        const snapshot = this.snapshots.get(receiptId);
        if (!snapshot) return;
        if (snapshot.leased > 0) {
            snapshot.expiredPending = true;
            return;
        }
        this.removeSnapshot(receiptId);
    }

    private removeSnapshot(receiptId: string): void {
        const snapshot = this.snapshots.get(receiptId);
        if (!snapshot) return;
        clearTimeout(snapshot.timer);
        this.snapshots.delete(receiptId);
    }

    private assertUsable(): void {
        if (this.disposed) {
            throw new NoteImageRemovalResourceError("missing", "Temporary image recovery is no longer available.");
        }
    }
}
