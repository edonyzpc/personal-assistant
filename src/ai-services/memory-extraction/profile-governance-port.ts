import {
    sanitizeUserProfileSnapshot,
    type UserProfileSnapshot,
} from "./type-a-extractor";
import type { UserProfileStore } from "./profile-store";

export type ProfileGovernanceMutation = (
    current: UserProfileSnapshot | null,
) => UserProfileSnapshot | Promise<UserProfileSnapshot>;

export interface ProfileGovernancePort {
    initialize(): Promise<UserProfileSnapshot | null>;
    readSnapshot(): UserProfileSnapshot | null;
    mutate(operation: ProfileGovernanceMutation): Promise<UserProfileSnapshot>;
    dispose(): Promise<void>;
}

/**
 * One serialized owner for Type-A extraction and lifecycle projections.
 * Persistence completes before the cache advances, so an older in-flight
 * extraction cannot overwrite a later correction through a second write path.
 */
export class SerializedProfileGovernancePort implements ProfileGovernancePort {
    private snapshot: UserProfileSnapshot | null = null;
    private initializePromise: Promise<UserProfileSnapshot | null> | null = null;
    private mutationTail: Promise<void> = Promise.resolve();
    private disposed = false;
    private disposePromise: Promise<void> | null = null;

    constructor(
        private readonly store: UserProfileStore,
        private readonly now: () => Date = () => new Date(),
    ) {}

    initialize(): Promise<UserProfileSnapshot | null> {
        this.assertActive();
        if (!this.initializePromise) {
            const run = this.initializeUnlocked().finally(() => {
                if (this.initializePromise === run) this.initializePromise = null;
            });
            this.initializePromise = run;
        }
        return this.initializePromise.then(cloneSnapshotOrNull);
    }

    readSnapshot(): UserProfileSnapshot | null {
        this.assertActive();
        return cloneSnapshotOrNull(this.snapshot);
    }

    mutate(operation: ProfileGovernanceMutation): Promise<UserProfileSnapshot> {
        this.assertActive();
        const run = this.mutationTail.then(async () => {
            this.assertActive();
            await this.initialize();
            const current = cloneSnapshotOrNull(this.snapshot);
            const proposed = await operation(current);
            this.assertActive();
            const next = sanitizeUserProfileSnapshot(proposed, this.now());
            if (!next) throw new Error("Profile governance mutation returned an empty snapshot.");
            assertImmutableProfileRecordIds(current, next);
            await this.store.setProfile(cloneSnapshot(next));
            this.assertActive();
            this.snapshot = cloneSnapshot(next);
            return cloneSnapshot(next);
        });
        this.mutationTail = run.then(() => undefined, () => undefined);
        return run;
    }

    dispose(): Promise<void> {
        if (this.disposePromise) return this.disposePromise;
        this.disposed = true;
        const initializeInFlight = this.initializePromise;
        this.disposePromise = (async () => {
            await Promise.allSettled([
                this.mutationTail,
                initializeInFlight ?? Promise.resolve(),
            ]);
            this.snapshot = null;
            await this.store.dispose();
        })();
        return this.disposePromise;
    }

    private async initializeUnlocked(): Promise<UserProfileSnapshot | null> {
        await this.store.initialize();
        this.assertActive();
        const stored = await this.store.getProfile();
        this.assertActive();
        const normalized = sanitizeUserProfileSnapshot(stored, this.now());
        if (stored && normalized && snapshotFingerprint(stored) !== snapshotFingerprint(normalized)) {
            await this.store.setProfile(cloneSnapshot(normalized));
            this.assertActive();
        }
        this.snapshot = cloneSnapshotOrNull(normalized);
        return cloneSnapshotOrNull(this.snapshot);
    }

    private assertActive(): void {
        if (this.disposed) throw new Error("Profile governance port is disposed.");
    }
}

function cloneSnapshotOrNull(snapshot: UserProfileSnapshot | null): UserProfileSnapshot | null {
    return snapshot ? cloneSnapshot(snapshot) : null;
}

function cloneSnapshot(snapshot: UserProfileSnapshot): UserProfileSnapshot {
    return {
        updatedAt: snapshot.updatedAt,
        markdown: snapshot.markdown,
        records: snapshot.records.map((record) => ({
            ...record,
            conversationIds: [...record.conversationIds],
        })),
    };
}

function snapshotFingerprint(snapshot: UserProfileSnapshot): string {
    return JSON.stringify(snapshot);
}

function assertImmutableProfileRecordIds(
    current: UserProfileSnapshot | null,
    next: UserProfileSnapshot,
): void {
    const nextIds = new Set<string>();
    const currentByKey = new Map(
        (current?.records ?? []).map((record) => [record.key, record.profileRecordId]),
    );
    for (const record of next.records) {
        const id = record.profileRecordId;
        if (!id || nextIds.has(id)) {
            throw new Error("Profile governance mutation produced an invalid or duplicate immutable ID.");
        }
        nextIds.add(id);
        const existingId = currentByKey.get(record.key);
        if (existingId && existingId !== id) {
            throw new Error("Profile governance mutation cannot replace an immutable ID.");
        }
    }
}
