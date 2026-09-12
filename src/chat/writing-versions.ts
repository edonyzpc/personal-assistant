import type { PersistedSourceRef } from '../pa/contracts/source-ref';
import type { MessageImage } from './image-types';
import { cloneWritingVersion, hashWritingText, mergeWritingImages, type WritingScene, type WritingVersion } from './writing-types';

export interface WritingVersionStore {
    getWritingVersion(id: string): Promise<WritingVersion | null>;
    putWritingVersion(version: WritingVersion, assertSourceCurrent?: () => void): Promise<void>;
    listWritingVersions(conversationId: string): Promise<WritingVersion[]>;
}

export class WritingVersionService {
    private chain: Promise<unknown> = Promise.resolve();
    private disposed = false;
    constructor(private readonly store: WritingVersionStore, private readonly now = Date.now) {}

    private assertOpen(): void {
        if (this.disposed) throw new Error('Writing versions closed');
    }

    async get(id: string): Promise<WritingVersion | null> {
        this.assertOpen();
        const stored = await this.store.getWritingVersion(id);
        this.assertOpen();
        if (!stored) return null;
        const version = cloneWritingVersion(stored);
        if (await hashWritingText(version.text) !== version.textHash) throw new Error('Writing version changed');
        this.assertOpen();
        return version;
    }

    async list(conversationId: string): Promise<WritingVersion[]> {
        this.assertOpen();
        const versions = await this.store.listWritingVersions(conversationId);
        this.assertOpen();
        const verified = await Promise.all(versions.map(async (stored) => {
            const version = cloneWritingVersion(stored);
            if (version.conversationId !== conversationId || await hashWritingText(version.text) !== version.textHash) {
                throw new Error('Writing version changed');
            }
            return version;
        }));
        this.assertOpen();
        return verified.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }

    create(input: {
        requestId: string; messageId: string; conversationId: string; turnIndex: number;
        text: string; explanation?: string; parentVersionId?: string;
        /** Complete host-approved material for this version, including any retained parent images. */
        images: readonly MessageImage[];
        backgroundSourceRefs?: PersistedSourceRef[]; styleRevisionIds?: string[]; scene?: WritingScene;
        /** Only a host editing UI supplies this; a model envelope has no origin field. */
        origin?: WritingVersion['origin'];
        referenceScope?: WritingVersion['referenceScope'];
        /** A legacy recovery cannot establish which request supplied its references. Host-only. */
        referenceScopeUnverified?: boolean;
    }, isCurrent: () => boolean = () => true): Promise<WritingVersion> {
        if (this.disposed) return Promise.reject(new Error('Writing versions closed'));
        const assertAdmission = () => {
            this.assertOpen();
            if (!isCurrent()) throw new Error('Writing conversation changed');
        };
        // Snapshot before joining the queue: the composer may change while an
        // earlier version is being persisted. Host metadata is never model data.
        const snapshot = cloneWritingVersion({
            id: 'pending', textHash: '0'.repeat(64), createdAt: 0,
            requestId: input.requestId, messageId: input.messageId, conversationId: input.conversationId,
            turnIndex: input.turnIndex, text: input.text, explanation: input.explanation ?? '',
            origin: input.origin ?? 'ai_generated', associatedImages: input.images,
            backgroundSourceRefs: input.backgroundSourceRefs ?? [], styleRevisionIds: input.styleRevisionIds ?? [],
            referenceScope: input.referenceScopeUnverified ? undefined
                : input.origin === 'user_edited' ? input.referenceScope : 'request',
            ...(input.parentVersionId ? { parentVersionId: input.parentVersionId } : {}),
            ...(input.scene ? { scene: input.scene } : {}),
        });
        const task = this.chain.then(async () => {
            assertAdmission();
            const textHash = await hashWritingText(snapshot.text);
            const versionId = `writing_${(await hashWritingText(`${snapshot.requestId}\0${snapshot.messageId}`)).slice(0, 48)}`;
            const parent = snapshot.parentVersionId ? await this.get(snapshot.parentVersionId) : null;
            if (snapshot.parentVersionId && (!parent || parent.conversationId !== snapshot.conversationId)) throw new Error('Writing parent unavailable');
            const sources = snapshot.backgroundSourceRefs;
            const sourceIdentities = new Set<string>();
            const version = cloneWritingVersion({
                ...snapshot, id: versionId, textHash, createdAt: this.now(),
                associatedImages: mergeWritingImages(snapshot.associatedImages),
                backgroundSourceRefs: sources.filter((source) => {
                    const key = JSON.stringify(source);
                    if (sourceIdentities.has(key)) return false;
                    sourceIdentities.add(key); return true;
                }),
                styleRevisionIds: [...new Set(snapshot.styleRevisionIds)],
                ...(snapshot.scene ? { scene: snapshot.scene } : {}),
            });
            const existing = await this.get(versionId);
            assertAdmission();
            if (existing) {
                if (JSON.stringify({ ...existing, createdAt: 0 }) !== JSON.stringify({ ...version, createdAt: 0 })) {
                    throw new Error('Writing event identity conflict');
                }
                return existing;
            }
            // Disposal drains an admitted write, but its sources must remain
            // authorized through the store's final mutation after async reads.
            await this.store.putWritingVersion(version, () => {
                if (!isCurrent()) throw new Error('Writing conversation changed');
            });
            return cloneWritingVersion(version);
        });
        this.chain = task.catch(() => undefined);
        return task;
    }

    async edit(parentId: string, text: string, actionId: string): Promise<WritingVersion> {
        const parent = await this.get(parentId);
        if (!parent) throw new Error('Writing version unavailable');
        if (text === parent.text) return parent;
        return this.create({
            requestId: actionId, messageId: actionId, conversationId: parent.conversationId, turnIndex: parent.turnIndex,
            parentVersionId: parent.id, text, explanation: parent.explanation, images: parent.associatedImages, origin: 'user_edited',
            backgroundSourceRefs: parent.backgroundSourceRefs, styleRevisionIds: parent.styleRevisionIds, scene: parent.scene,
            referenceScope: parent.referenceScope,
        });
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        await this.chain;
    }
}
