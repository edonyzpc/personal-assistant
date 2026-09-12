import { prepareWritingRecoverySources, type WritingRecoverySourceHost } from '../src/chat/writing-recovery-sources';
import { WritingVersionService } from '../src/chat/writing-versions';
import { hashWritingText, type WritingVersion } from '../src/chat/writing-types';
import type { ChatTurnMemoryMetadata, ChatWritingRecovery } from '../src/ai-services/chat-types';
import type { MessageImage } from '../src/chat/image-types';
import type { GenerationInputSnapshot } from '../src/ai-services/generation-input-snapshot';

const recovery = (): ChatWritingRecovery => ({ requestId: 'request', rawText: 'Old AI draft', reason: 'invalid_output' });
const photo = (id: string): MessageImage => ({ ref: { assetId: id, contentHash: 'a'.repeat(64) }, ordinal: 1, label: id });
function setup() {
    const current = { lifetime: true, note: true, image: true };
    const host: WritingRecoverySourceHost = {
        captureLifetime: jest.fn(() => () => current.lifetime),
        isMemoryAllowed: () => true,
        verifyNote: jest.fn(async () => ({ isCurrent: () => current.note })),
        verifyImage: jest.fn(async () => ({ isCurrent: () => current.image })),
        verifyGenerationSource: jest.fn(async () => ({ isCurrent: () => current.note })),
    };
    return { host, current };
}
function generationInput(overrides: Partial<GenerationInputSnapshot> = {}): GenerationInputSnapshot {
    return {
        schemaVersion: 1, inputPurpose: 'writing', task: { state: 'none', sources: [] },
        personal: { state: 'none' }, insights: { state: 'none' }, style: { state: 'none' }, images: [],
        parent: { state: 'none' }, pagelet: { state: 'none' }, ...overrides,
    };
}
async function parent(): Promise<WritingVersion> {
    return { id: 'parent', requestId: 'request-parent', messageId: 'message-parent', conversationId: 'chat',
        turnIndex: 0, text: 'Parent body', textHash: await hashWritingText('Parent body'), createdAt: 0,
        explanation: '', origin: 'ai_generated', associatedImages: [photo('parent-photo')],
        backgroundSourceRefs: [{ path: 'parent.md' }], styleRevisionIds: ['style-used'] };
}

describe('explicitly confirmed recovery source revalidation', () => {
    test('uses the physical snapshot instead of adding the run-end source union', async () => {
        const { host } = setup();
        const input = generationInput({ task: { state: 'identified', sources: [{
            purpose: 'task_material', kind: 'context-used', boundary: 'read-only-tool', dedupKey: 'note:B.md',
            revision: { state: 'identified', scope: 'current_process', path: 'B.md', mtime: 2, size: 3 },
        }] } });
        const metadata: ChatTurnMemoryMetadata = { hasMemoryContent: false, allowedMemorySourcePaths: [], sourceRecords: [
            { kind: 'context-used', dedupKey: 'note:A.md', path: 'A.md', sourceBoundary: 'read-only-tool' },
            { kind: 'context-used', dedupKey: 'note:B.md', path: 'B.md', sourceBoundary: 'read-only-tool' },
        ] };
        await prepareWritingRecoverySources(host, { ...recovery(), generationInput: input }, [], 'chat', metadata);
        expect(host.verifyGenerationSource).toHaveBeenCalledTimes(1);
        expect(host.verifyGenerationSource).toHaveBeenCalledWith({ kind: 'task', source: input.task.sources[0] });
        expect(host.verifyNote).not.toHaveBeenCalled();
    });

    test('preserves same-path task purposes and sources that exist only in the snapshot', async () => {
        const { host } = setup();
        const sources: GenerationInputSnapshot['task']['sources'] = [
            { purpose: 'task_material', kind: 'memory-reference', boundary: 'memory', dedupKey: 'memory:same',
                revision: { state: 'unknown', path: 'Same.md' } },
            { purpose: 'task_material', kind: 'context-used', boundary: 'read-only-tool', dedupKey: 'tool:same',
                capabilityName: 'read_note_outline', revision: { state: 'unknown', path: 'Same.md' } },
        ];
        await prepareWritingRecoverySources(host, { ...recovery(), generationInput: generationInput({
            task: { state: 'unknown', sources },
        }) }, [], 'chat');
        expect(host.verifyGenerationSource).toHaveBeenNthCalledWith(1, { kind: 'task', source: sources[0] });
        expect(host.verifyGenerationSource).toHaveBeenNthCalledWith(2, { kind: 'task', source: sources[1] });
        expect(host.verifyNote).not.toHaveBeenCalled();
    });

    test('requires exact snapshot images and parent identity before reading sources', async () => {
        const { host } = setup();
        const version = await parent();
        host.versions = { get: jest.fn(async () => version) };
        const input = generationInput({
            images: [{ ref: photo('used').ref, hashAlgorithm: 'sha256' }],
            parent: { state: 'identified', versionId: version.id,
                textHash: { algorithm: 'sha256', value: version.textHash } },
        });
        const draft = { ...recovery(), parentVersionId: version.id, generationInput: input };
        expect((await prepareWritingRecoverySources(host, draft, [photo('used')], 'chat')).isCurrent()).toBe(true);
        await expect(prepareWritingRecoverySources(host, draft, [], 'chat'))
            .rejects.toThrow('image snapshot changed');
        await expect(prepareWritingRecoverySources(host, { ...draft, parentVersionId: undefined }, [photo('used')], 'chat'))
            .rejects.toThrow('parent snapshot changed');
        host.versions = { get: jest.fn(async () => ({ ...version, textHash: 'b'.repeat(64) })) };
        await expect(prepareWritingRecoverySources(host, draft, [photo('used')], 'chat'))
            .rejects.toThrow('Writing parent unavailable');
    });

    test('rejects an earlier generation source revoked while verifying a later image', async () => {
        const { host, current } = setup();
        const image = photo('used');
        host.verifyImage = async () => { current.note = false; return { isCurrent: () => true }; };
        await expect(prepareWritingRecoverySources(host, {
            ...recovery(), generationInput: generationInput({
                task: { state: 'unknown', sources: [{ purpose: 'task_material', kind: 'context-used',
                    boundary: 'read-only-tool', dedupKey: 'note:used', revision: { state: 'unknown', path: 'used.md' } }] },
                images: [{ ref: image.ref, hashAlgorithm: 'sha256' }],
            }),
        }, [image], 'chat')).rejects.toThrow('Writing recovery sources changed');
    });

    test('does not infer missing historical Personal or style identities from current sources', async () => {
        const { host } = setup();
        expect((await prepareWritingRecoverySources(host, recovery(), [], 'chat')).isCurrent()).toBe(true);
        expect(host.verifyNote).not.toHaveBeenCalled();
    });

    test('captures typed Memory purpose before awaits and checks later Memory revocation', async () => {
        const { host } = setup();
        let enabled = true;
        host.isMemoryAllowed = () => enabled;
        const metadata: ChatTurnMemoryMetadata = { hasMemoryContent: true, allowedMemorySourcePaths: [],
            sourceRecords: [{ kind: 'memory-reference', dedupKey: 'used', path: 'used.md', sourceBoundary: 'memory' }] };
        host.verifyNote = jest.fn(async () => {
            metadata.sourceRecords![0]!.sourceBoundary = 'current-note';
            metadata.sourceRecords![0]!.path = 'not-used.md';
            metadata.sourceRecords![0]!.kind = 'context-used';
            metadata.hasMemoryContent = false;
            return { isCurrent: () => true };
        });
        const receipt = await prepareWritingRecoverySources(host, recovery(), [], 'chat', metadata);
        expect(host.verifyNote).toHaveBeenCalledWith({ path: 'used.md' }, true);
        expect(host.verifyNote).toHaveBeenCalledTimes(1);
        expect(receipt.isCurrent()).toBe(true);
        enabled = false;
        expect(receipt.isCurrent()).toBe(false);
    });

    test('retains a status-only record explicitly marked as a source dependency', async () => {
        const { host } = setup();
        const metadata: ChatTurnMemoryMetadata = { hasMemoryContent: false, allowedMemorySourcePaths: [],
            sourceRecords: [{ kind: 'memory-reference', dedupKey: 'used', path: 'used.md', sourceBoundary: 'memory',
                statusOnly: true, metadata: { sourceDependency: true } }] };
        expect((await prepareWritingRecoverySources(host, recovery(), [], 'chat', metadata)).isCurrent()).toBe(true);
        expect(host.verifyNote).toHaveBeenCalledWith({ path: 'used.md' }, true);
        host.isMemoryAllowed = () => false;
        await expect(prepareWritingRecoverySources(host, recovery(), [], 'chat', metadata)).rejects.toThrow('Writing recovery sources changed');
    });

    test('verifies recorded notes and selected images without inheriting a parent background/style selection', async () => {
        const { host, current } = setup();
        const version = await parent();
        host.versions = { get: jest.fn(async () => ({ ...version, parentVersionId: 'unused-ancestor' })) };
        const receipt = await prepareWritingRecoverySources(host, {
            ...recovery(), parentVersionId: version.id, backgroundSourceRefs: [{ path: 'selected.md' }],
        }, [photo('parent-photo'), photo('new-photo')], 'chat');
        expect(host.versions.get).toHaveBeenCalledTimes(1);
        expect(host.verifyNote).toHaveBeenCalledWith({ path: 'selected.md' }, false);
        expect(host.verifyNote).toHaveBeenCalledTimes(1);
        expect(host.verifyImage).toHaveBeenCalledTimes(2);
        expect(receipt.isCurrent()).toBe(true);
        current.note = false;
        expect(receipt.isCurrent()).toBe(false);
    });

    test.each(['missing', 'other conversation', 'corrupt hash'])('rejects a %s parent through the real version reader', async (failure) => {
        const { host } = setup();
        const version = await parent();
        host.versions = new WritingVersionService({
            getWritingVersion: async () => failure === 'missing' ? null : {
                ...version, ...(failure === 'other conversation' ? { conversationId: 'other' } : {}),
                ...(failure === 'corrupt hash' ? { text: 'Tampered body' } : {}),
            },
            putWritingVersion: async () => undefined,
            listWritingVersions: async () => [],
        });
        await expect(prepareWritingRecoverySources(host, { ...recovery(), parentVersionId: version.id }, [], 'chat')).rejects.toThrow();
    });

    test.each([{ images: [] }, { images: [photo('selected-b')] }])('uses the complete resolved image selection $images without restoring omitted parent images', async ({ images }) => {
        const { host } = setup();
        const version = await parent();
        host.versions = { get: async () => ({ ...version, associatedImages: [photo('omitted-a'), photo('selected-b')] }) };
        let selectedCurrent = true;
        host.verifyImage = jest.fn(async (image) => {
            if (image.ref.assetId === 'omitted-a') throw new Error('Omitted parent image was deleted');
            return { isCurrent: () => selectedCurrent };
        });
        const receipt = await prepareWritingRecoverySources(host, { ...recovery(), parentVersionId: version.id }, images, 'chat');
        expect(host.verifyImage).toHaveBeenCalledTimes(images.length);
        expect(receipt.isCurrent()).toBe(true);
        selectedCurrent = false;
        expect(receipt.isCurrent()).toBe(images.length === 0);
        if (images.length) {
            await expect(prepareWritingRecoverySources(host, { ...recovery(), parentVersionId: version.id }, images, 'chat'))
                .rejects.toThrow('Writing recovery sources changed');
        }
    });

    test.each(['note', 'image', 'lifetime'] as const)('keeps the %s check live through final persistence', async (kind) => {
        const { host, current } = setup();
        const receipt = await prepareWritingRecoverySources(host, {
            ...recovery(), backgroundSourceRefs: [{ path: 'used.md' }],
        }, [photo('used')], 'chat');
        expect(receipt.isCurrent()).toBe(true);
        current[kind] = false;
        expect(receipt.isCurrent()).toBe(false);
    });

    test('rejects an earlier source revoked while verifying a later image', async () => {
        const { host, current } = setup();
        host.verifyImage = async () => { current.note = false; return { isCurrent: () => true }; };
        await expect(prepareWritingRecoverySources(host, {
            ...recovery(), backgroundSourceRefs: [{ path: 'used.md' }],
        }, [photo('used')], 'chat')).rejects.toThrow('Writing recovery sources changed');
    });

    test('does not turn a recorded-source read failure into unrecorded-source consent', async () => {
        const { host } = setup();
        host.verifyNote = async () => { throw new Error('Read failed'); };
        await expect(prepareWritingRecoverySources(host, {
            ...recovery(), backgroundSourceRefs: [{ path: 'used.md' }],
        }, [], 'chat')).rejects.toThrow('Read failed');
    });

    test('rejects malformed source paths before any source read', async () => {
        const { host } = setup();
        await expect(prepareWritingRecoverySources(host, {
            ...recovery(), backgroundSourceRefs: [{ path: '../private.md' }],
        }, [], 'chat')).rejects.toThrow('Writing source reference invalid');
        expect(host.verifyNote).not.toHaveBeenCalled();
    });
});
