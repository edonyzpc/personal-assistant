import { ComposerDraft } from '../src/chat/composer-draft';
import { decodeComposerRecovery, projectComposerRecovery, recoverComposerReferences } from '../src/chat/composer-recovery';
import type { MessageImage } from '../src/chat/image-types';
import type { ImageAssetService } from '../src/chat/image-assets';

const image: MessageImage = { ref: { assetId: 'image-1', contentHash: 'a'.repeat(64) }, ordinal: 1, label: 'Photo' };

describe('composer recovery projection', () => {
    it('keeps only source provenance and blocks prepared prompts until explicit reselection', async () => {
        const draft = new ComposerDraft<MessageImage>();
        draft.setImageIntent({ referenceImageRefs: [], preparedPrompt: 'prepared', reusePreparedPrompt: true,
            sourceReceipt: () => true, textSource: { kind: 'note', path: 'note.md', displayName: 'Note',
                file: { privateHost: true }, text: 'secret note text', documentText: 'secret document',
                inputLineage: { schemaVersion: 1, completeness: 'complete', dependencies: [] } } });
        const saved = projectComposerRecovery(draft.snapshot('User prompt'));
        const bytes = JSON.stringify(saved);
        expect(bytes).not.toMatch(/privateHost|secret|sourceReceipt|draftId|revision/);
        const restored = await recoverComposerReferences(decodeComposerRecovery(JSON.parse(bytes)), undefined,
            () => true, 'Choose attachment again');
        const reopened = new ComposerDraft<MessageImage>();
        reopened.loadRecovered(restored);
        expect(reopened.snapshot(restored.text).imageIntent?.recoverySourceLabel).toBe('Note');
        expect(reopened.canSend(restored.text)).toBe(false);
        reopened.setImageTextSource(undefined);
        expect(reopened.canSend(restored.text)).toBe(true);
        expect(reopened.snapshot('').imageIntent?.reusePreparedPrompt).toBeUndefined();
    });

    it('revalidates ready image references and retains unavailable imports as unsendable entries', async () => {
        const draft = new ComposerDraft<MessageImage>();
        const ready = draft.beginImport('Photo');
        draft.completeImport(ready, image);
        draft.beginImport('Still importing');
        const saved = projectComposerRecovery(draft.snapshot('caption'));
        const verify = jest.fn(async () => ({ isCurrent: () => false }));
        const restored = await recoverComposerReferences(saved,
            { verify } as unknown as Pick<ImageAssetService, 'verify'>, () => true, 'Choose again');
        expect(verify).toHaveBeenCalledWith(image.ref, 'preview', expect.objectContaining({ isCurrent: expect.any(Function) }));
        expect(restored.images.map(entry => entry.status)).toEqual(['error', 'error']);
        const reopened = new ComposerDraft<MessageImage>();
        reopened.loadRecovered(restored);
        expect(reopened.canSend(restored.text)).toBe(false);
    });

    it('does not unlock missing reference images by removing an unrelated text source', async () => {
        const saved = { text: 'Edit this', images: [], imageIntent: { operation: 'edit' as const,
            referenceImageRefs: [image.ref], recoverySourceLabel: 'Note' } };
        const restored = await recoverComposerReferences(saved, undefined, () => true, 'Choose again');
        const reopened = new ComposerDraft<MessageImage>();
        reopened.loadRecovered(restored);
        reopened.setImageTextSource(undefined);
        expect(reopened.canSend(restored.text)).toBe(false);
        expect(reopened.snapshot('').imageIntent?.recoveryReferencesMissing).toBe(true);
        reopened.clearImageIntent();
        expect(reopened.canSend(restored.text)).toBe(true);
    });

    it('preserves explicit writing parent identity but never serializes its version object', () => {
        const draft = new ComposerDraft<MessageImage>();
        draft.setWritingIntent();
        const saved = projectComposerRecovery(draft.snapshot('Revise this'), 'version-1');
        expect(decodeComposerRecovery(saved)).toEqual({ text: 'Revise this', images: [], writingIntent: true, writingParentId: 'version-1' });
    });
});
