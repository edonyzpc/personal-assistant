import type { PersistedSourceRef } from '../pa/contracts/source-ref';
import type { MessageImage } from './image-types';
import { cloneWritingVersion, hashWritingText, mergeWritingImages, type WritingScene, type WritingVersion } from './writing-types';

export interface WritingVersionStore {
    getWritingVersion(id: string): Promise<WritingVersion | null>;
    putWritingVersion(version: WritingVersion): Promise<void>;
    listWritingVersions(conversationId: string): Promise<WritingVersion[]>;
}

export class WritingVersionService {
    private chain: Promise<unknown> = Promise.resolve();
    private disposed = false;
    constructor(private readonly store: WritingVersionStore, private readonly now = Date.now) {}

    async get(id: string): Promise<WritingVersion | null> {
        if (this.disposed) throw new Error('Writing versions closed');
        const stored = await this.store.getWritingVersion(id);
        if (!stored) return null;
        const version = cloneWritingVersion(stored);
        if (await hashWritingText(version.text) !== version.textHash) throw new Error('Writing version changed');
        return version;
    }

    async list(conversationId: string): Promise<WritingVersion[]> {
        if (this.disposed) throw new Error('Writing versions closed');
        const versions = await this.store.listWritingVersions(conversationId);
        const verified = await Promise.all(versions.map(async (stored) => {
            const version = cloneWritingVersion(stored);
            if (version.conversationId !== conversationId || await hashWritingText(version.text) !== version.textHash) {
                throw new Error('Writing version changed');
            }
            return version;
        }));
        return verified.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }

    create(input: {
        requestId: string; messageId: string; conversationId: string; turnIndex: number;
        text: string; explanation?: string; parentVersionId?: string; images: readonly MessageImage[];
        backgroundSourceRefs?: PersistedSourceRef[]; styleRevisionIds?: string[]; scene?: WritingScene;
        /** Only a host editing UI supplies this; a model envelope has no origin field. */
        origin?: WritingVersion['origin'];
    }): Promise<WritingVersion> {
        if (this.disposed) return Promise.reject(new Error('Writing versions closed'));
        // Snapshot before joining the queue: the composer may change while an
        // earlier version is being persisted. Host metadata is never model data.
        const snapshot = cloneWritingVersion({
            id: 'pending', textHash: '0'.repeat(64), createdAt: 0,
            requestId: input.requestId, messageId: input.messageId, conversationId: input.conversationId,
            turnIndex: input.turnIndex, text: input.text, explanation: input.explanation ?? '',
            origin: input.origin ?? 'ai_generated', associatedImages: input.images,
            backgroundSourceRefs: input.backgroundSourceRefs ?? [], styleRevisionIds: input.styleRevisionIds ?? [],
            ...(input.parentVersionId ? { parentVersionId: input.parentVersionId } : {}),
            ...(input.scene ? { scene: input.scene } : {}),
        });
        const task = this.chain.then(async () => {
            const textHash = await hashWritingText(snapshot.text);
            const versionId = `writing_${(await hashWritingText(`${snapshot.requestId}\0${snapshot.messageId}`)).slice(0, 48)}`;
            const parent = snapshot.parentVersionId ? await this.get(snapshot.parentVersionId) : null;
            if (snapshot.parentVersionId && (!parent || parent.conversationId !== snapshot.conversationId)) throw new Error('Writing parent unavailable');
            const sources = [...(parent?.backgroundSourceRefs ?? []), ...snapshot.backgroundSourceRefs];
            const sourceIdentities = new Set<string>();
            const version = cloneWritingVersion({
                ...snapshot, id: versionId, textHash, createdAt: this.now(),
                associatedImages: mergeWritingImages(parent?.associatedImages ?? [], snapshot.associatedImages),
                backgroundSourceRefs: sources.filter((source) => {
                    const key = JSON.stringify(source);
                    if (sourceIdentities.has(key)) return false;
                    sourceIdentities.add(key); return true;
                }),
                styleRevisionIds: [...new Set([...(parent?.styleRevisionIds ?? []), ...snapshot.styleRevisionIds])],
                ...(snapshot.scene ? { scene: snapshot.scene } : {}),
            });
            const existing = await this.get(versionId);
            if (existing) {
                if (JSON.stringify({ ...existing, createdAt: 0 }) !== JSON.stringify({ ...version, createdAt: 0 })) {
                    throw new Error('Writing event identity conflict');
                }
                return existing;
            }
            await this.store.putWritingVersion(version);
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
            parentVersionId: parent.id, text, explanation: parent.explanation, images: [], origin: 'user_edited',
            backgroundSourceRefs: parent.backgroundSourceRefs, styleRevisionIds: parent.styleRevisionIds, scene: parent.scene,
        });
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        await this.chain;
    }
}
