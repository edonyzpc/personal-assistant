import { cloneRecordedInputLineage } from '../ai-services/input-lineage';
import type { ComposerImageIntent, ComposerSnapshot } from './composer-draft';
import { cloneImageRef, cloneMessageImages, type MessageImage } from './image-types';
import type { ImageAssetService } from './image-assets';

export interface ComposerRecoveryDraft {
    text: string;
    images: Array<{ label: string; image?: MessageImage }>;
    imageIntent?: ComposerImageIntent;
    writingIntent?: true;
    ghostIntent?: true;
    writingParentId?: string;
    pageletReselectionRequired?: true;
}
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid draft record');
    return value as Record<string, unknown>;
}
function text(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Invalid draft text');
    return value;
}

/** Re-project at both boundaries. No host file, receipt, callback or binary enters storage. */
function projectImageIntent(value: unknown): ComposerImageIntent {
    const input = record(value);
    if (!Array.isArray(input.referenceImageRefs)) throw new Error('Invalid draft image references');
    const result: ComposerImageIntent = { referenceImageRefs: input.referenceImageRefs.map(cloneImageRef) };
    if (input.operation !== undefined) {
        if (!['generate', 'reference', 'edit'].includes(String(input.operation))) throw new Error('Invalid image operation');
        result.operation = input.operation as ComposerImageIntent['operation'];
    }
    if (input.parentVersionId !== undefined) result.parentVersionId = text(input.parentVersionId);
    if (input.preparedPrompt !== undefined) result.preparedPrompt = text(input.preparedPrompt);
    if (input.reusePreparedPrompt === true) result.reusePreparedPrompt = true;
    const lineage = cloneRecordedInputLineage(input.promptLineage);
    if (lineage) result.promptLineage = lineage;
    if (input.promptOrigin !== undefined) {
        const origin = record(input.promptOrigin);
        if (origin.kind !== 'note' && origin.kind !== 'selection') throw new Error('Invalid prompt origin');
        const inputLineage = cloneRecordedInputLineage(origin.inputLineage);
        if (!inputLineage) throw new Error('Missing prompt lineage');
        result.promptOrigin = { kind: origin.kind, path: text(origin.path),
            displayName: text(origin.displayName), inputLineage };
        if (origin.selection !== undefined) {
            const selection = record(origin.selection);
            if (!Number.isSafeInteger(selection.from) || !Number.isSafeInteger(selection.to)) throw new Error('Invalid source selection');
            result.promptOrigin.selection = { from: selection.from as number, to: selection.to as number };
        }
    }
    if (input.generationOptions !== undefined) {
        const options = record(input.generationOptions);
        if (typeof options.count !== 'number' || !Number.isFinite(options.count)) throw new Error('Invalid image count');
        result.generationOptions = { model: text(options.model), count: options.count,
            attachmentPathHint: text(options.attachmentPathHint) };
    }
    const source = input.textSource === undefined ? undefined : record(input.textSource);
    if (input.recoverySourceLabel !== undefined) result.recoverySourceLabel = text(input.recoverySourceLabel);
    else if (source || input.sourceReceipt || input.promptOrigin || input.reusePreparedPrompt) {
        result.recoverySourceLabel = source ? text(source.displayName) : result.promptOrigin?.displayName || 'source';
    }
    return result;
}

export function projectComposerRecovery(snapshot: ComposerSnapshot<MessageImage>, writingParentId?: string, hasPageletContext = false): ComposerRecoveryDraft {
    return {
        text: snapshot.text,
        images: snapshot.images.map(entry => ({ label: entry.label,
            ...(entry.status === 'ready' && entry.value ? { image: cloneMessageImages([entry.value])[0] } : {}) })),
        ...(snapshot.imageIntent ? { imageIntent: projectImageIntent(snapshot.imageIntent) } : {}),
        ...(snapshot.writingIntent ? { writingIntent: true } : {}),
        ...(snapshot.ghostIntent ? { ghostIntent: true } : {}),
        ...(snapshot.writingIntent && writingParentId ? { writingParentId } : {}),
        ...(snapshot.pageletReselectionRequired || hasPageletContext ? { pageletReselectionRequired: true } : {}),
    };
}

export function decodeComposerRecovery(value: unknown): ComposerRecoveryDraft {
    const input = record(value);
    if (!Array.isArray(input.images) || input.images.length > 8) throw new Error('Invalid composer images');
    if ((input.writingIntent !== undefined && input.writingIntent !== true)
        || (input.ghostIntent !== undefined && input.ghostIntent !== true)
        || (input.pageletReselectionRequired !== undefined && input.pageletReselectionRequired !== true)) throw new Error('Invalid composer intent');
    return {
        text: text(input.text),
        images: input.images.map(value => {
            const entry = record(value);
            return { label: text(entry.label), ...(entry.image !== undefined
                ? { image: cloneMessageImages([entry.image])[0] } : {}) };
        }),
        ...(input.imageIntent ? { imageIntent: projectImageIntent(input.imageIntent) } : {}),
        ...(input.writingIntent ? { writingIntent: true } : {}),
        ...(input.ghostIntent ? { ghostIntent: true } : {}),
        ...(input.writingParentId !== undefined ? { writingParentId: text(input.writingParentId) } : {}),
        ...(input.pageletReselectionRequired ? { pageletReselectionRequired: true } : {}),
    };
}

export function isEmptyComposerRecovery(draft: ComposerRecoveryDraft): boolean {
    return !draft.text && draft.images.length === 0 && !draft.imageIntent && !draft.writingIntent
        && !draft.ghostIntent && !draft.pageletReselectionRequired;
}

export async function recoverComposerReferences(
    draft: ComposerRecoveryDraft,
    assets: Pick<ImageAssetService, 'verify'> | undefined,
    isCurrent: () => boolean,
    unavailableLabel: string,
): Promise<Omit<ComposerSnapshot<MessageImage>, 'draftId' | 'revision'>> {
    const images = await Promise.all(draft.images.map(async (entry, index) => {
        let valid = false;
        if (entry.image && assets) {
            try {
                const verified = await assets.verify(entry.image.ref, 'preview', { isCurrent });
                valid = isCurrent() && verified.isCurrent();
            } catch { /* A missing/changed reference remains visible and cannot be sent. */ }
        }
        return { id: index + 1, label: entry.label, status: valid ? 'ready' as const : 'error' as const,
            ...(valid ? { value: entry.image } : { error: unavailableLabel }) };
    }));
    const intent = draft.imageIntent ? projectImageIntent(draft.imageIntent) : undefined;
    if (intent?.referenceImageRefs.length) {
        for (const ref of intent.referenceImageRefs) {
            try {
                if (!assets) throw new Error('Unavailable image service');
                const verified = await assets.verify(ref, 'preview', { isCurrent });
                if (!isCurrent() || !verified.isCurrent()) throw new Error('Changed reference');
            } catch { intent.recoveryReferencesMissing = true; }
        }
    }
    return { text: draft.text, images,
        ...(intent ? { imageIntent: intent } : {}),
        ...(draft.writingIntent ? { writingIntent: true } : {}),
        ...(draft.ghostIntent ? { ghostIntent: true } : {}),
        ...(draft.pageletReselectionRequired ? { pageletReselectionRequired: true } : {}) };
}
