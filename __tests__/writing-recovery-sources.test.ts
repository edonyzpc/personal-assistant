import { prepareWritingRecoverySources, type WritingRecoverySourceHost } from '../src/chat/writing-recovery-sources';
import { WritingVersionService } from '../src/chat/writing-versions';
import { hashWritingText, type WritingVersion } from '../src/chat/writing-types';
import type { ChatTurnMemoryMetadata, ChatWritingRecovery } from '../src/ai-services/chat-types';
import type { MessageImage } from '../src/chat/image-types';
import type { GenerationInputSnapshot, GenerationInputSnapshotV1, GenerationInputSnapshotV2 } from '../src/ai-services/generation-input-snapshot';
import { completeInputLineage, generationInputSnapshotInputLineage, resolveWritingVersionInputLineage,
    toGenerationInputLineage, writingVersionInputLineage } from '../src/ai-services/input-lineage';
import type { InputDependency } from '../src/ai-services/input-lineage';

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
function generationInput(overrides: Partial<GenerationInputSnapshotV1> = {}): GenerationInputSnapshotV1 {
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
function v2RecoveryWithParent(version: WritingVersion, dependencies: InputDependency[] = [
    { kind: 'user-text', messageId: 'child-user' },
    { kind: 'writing-version', versionId: version.id, textHash: version.textHash },
]): ChatWritingRecovery {
    return { ...recovery(), parentVersionId: version.id, generationInput: {
        schemaVersion: 2, inputPurpose: 'writing', task: { state: 'none', sources: [] },
        personal: { state: 'none' }, insights: { state: 'none' }, style: { state: 'none' },
        images: [], pagelet: { state: 'none' },
        parent: { state: 'identified', versionId: version.id,
            textHash: { algorithm: 'sha256', value: version.textHash } },
        lineage: toGenerationInputLineage(completeInputLineage(dependencies), []),
    } };
}

describe('explicitly confirmed recovery source revalidation', () => {
    test('does not treat an identified Personal field omitted from complete v2 lineage as a complete recovery', async () => {
        const { host } = setup();
        const personal = { state: 'identified' as const, mode: 'governed' as const,
            revisions: [{ claimId: 'claim-1', revisionId: 'revision-1' }] };
        const snapshot: GenerationInputSnapshot = { schemaVersion: 2, inputPurpose: 'writing',
            task: { state: 'none', sources: [] }, personal, insights: { state: 'none' },
            style: { state: 'none' }, images: [], parent: { state: 'none' }, pagelet: { state: 'none' },
            lineage: toGenerationInputLineage(completeInputLineage([
                { kind: 'user-text', messageId: 'user-1' },
            ]), []),
        };
        expect(generationInputSnapshotInputLineage(snapshot).completeness).toBe('unknown');
        const receipt = await prepareWritingRecoverySources(host, { ...recovery(), generationInput: snapshot }, [], 'chat');
        expect(host.verifyGenerationSource).toHaveBeenCalledWith({ kind: 'personal', source: personal });
        expect(receipt.lineageComplete).toBe(false);
        expect(writingVersionInputLineage({ ...await parent(), generationInput: snapshot }).completeness).toBe('unknown');
        host.verifyGenerationSource = jest.fn(async source => {
            if (source.kind === 'personal') throw new Error('Personal source revoked');
            return { isCurrent: () => true };
        });
        await expect(prepareWritingRecoverySources(host, { ...recovery(), generationInput: snapshot }, [], 'chat'))
            .rejects.toThrow('Personal source revoked');
        const malformedBeforeKnownSource: GenerationInputSnapshotV2 = { ...snapshot,
            personal: { state: 'none' }, lineage: { state: 'complete', dependencies: [
                { kind: 'current_input', identity: '{' },
                { kind: 'personal', identity: JSON.stringify({ kind: 'personal', source: personal }) },
            ] } };
        await expect(prepareWritingRecoverySources(host,
            { ...recovery(), generationInput: malformedBeforeKnownSource }, [], 'chat'))
            .rejects.toThrow('Personal source revoked');
    });

    test('requires complete v2 lineage to cover each recorded material and observed task revision', () => {
        const personal = { state: 'identified' as const, mode: 'governed' as const,
            revisions: [{ claimId: 'claim-1', revisionId: 'revision-1' }] };
        const taskSource: GenerationInputSnapshotV2['task']['sources'][number] = {
            purpose: 'task_material', kind: 'context-used', boundary: 'read-only-tool',
            dedupKey: 'note:A', path: 'A.md', revision: { state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: 'a'.repeat(40) } },
        };
        const selected = photo('selected');
        const complete = toGenerationInputLineage(completeInputLineage([
            { kind: 'user-text', messageId: 'user-1' },
            { kind: 'vault', path: 'A.md', via: 'note' },
            { kind: 'personal', source: personal },
            { kind: 'writing-style', revisionIds: ['style-1'] },
            { kind: 'attachment', ownerMessageId: 'user-1', ref: selected.ref },
        ]), [taskSource]);
        if (complete.state !== 'complete') throw new Error('Expected complete lineage fixture');
        const snapshot: GenerationInputSnapshotV2 = { schemaVersion: 2, inputPurpose: 'writing',
            task: { state: 'identified', sources: [taskSource] }, personal, insights: { state: 'none' },
            style: { state: 'identified', revisionIds: ['style-1'] },
            images: [{ ref: selected.ref, hashAlgorithm: 'sha256' }],
            parent: { state: 'none' }, pagelet: { state: 'none' }, lineage: complete,
        };
        expect(generationInputSnapshotInputLineage(snapshot).completeness).toBe('complete');
        for (const kind of ['vault', 'personal', 'style', 'image'] as const) {
            expect(generationInputSnapshotInputLineage({ ...snapshot, lineage: {
                state: 'complete', dependencies: complete.dependencies.filter(item => item.kind !== kind),
            } }).completeness).toBe('unknown');
        }
        expect(generationInputSnapshotInputLineage({ ...snapshot, task: { state: 'identified', sources: [
            { ...taskSource, revision: { state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: 'b'.repeat(40) } } },
        ] } }).completeness).toBe('unknown');
        expect(generationInputSnapshotInputLineage({ ...snapshot, pagelet: { state: 'unknown',
            id: 'pagelet-1', pipelineVersion: 'pagelet-v1',
            anchor: { path: 'A.md', mtime: 1, size: 1,
                contentHash: { algorithm: 'unspecified', value: 'a'.repeat(64) } }, sources: [],
        } }).completeness).toBe('unknown');
    });

    test('rejects a revoked Personal dependency inherited only through a v2 parent', async () => {
        const { host } = setup();
        const original = await parent();
        const personal = { state: 'identified' as const, mode: 'governed' as const,
            revisions: [{ claimId: 'private-claim', revisionId: 'revoked-revision' }] };
        const parentVersion: WritingVersion = { ...original, generationInput: {
            schemaVersion: 2, inputPurpose: 'writing', task: { state: 'none', sources: [] },
            lineage: toGenerationInputLineage(completeInputLineage([
                { kind: 'user-text', messageId: 'parent-user' }, { kind: 'personal', source: personal },
            ]), []), personal, insights: { state: 'none' }, style: { state: 'none' }, images: [],
            parent: { state: 'none' }, pagelet: { state: 'none' },
        } };
        host.versions = { get: jest.fn(async () => parentVersion) };
        host.verifyGenerationSource = jest.fn(async source => {
            if (source.kind === 'personal') throw new Error('Personal source revoked');
            return { isCurrent: () => true };
        });
        const child: ChatWritingRecovery = { ...recovery(), parentVersionId: parentVersion.id,
            generationInput: { schemaVersion: 2, inputPurpose: 'writing',
                task: { state: 'none', sources: [] }, personal: { state: 'none' }, insights: { state: 'none' },
                style: { state: 'none' }, images: [], pagelet: { state: 'none' },
                parent: { state: 'identified', versionId: parentVersion.id,
                    textHash: { algorithm: 'sha256', value: parentVersion.textHash } },
                lineage: toGenerationInputLineage(completeInputLineage([
                    { kind: 'user-text', messageId: 'child-user' },
                    { kind: 'writing-version', versionId: parentVersion.id, textHash: parentVersion.textHash },
                ]), []),
            } };

        await expect(prepareWritingRecoverySources(host, child, [], 'chat'))
            .rejects.toThrow('Personal source revoked');
        expect(host.verifyGenerationSource).toHaveBeenCalledWith({ kind: 'personal', source: personal });
    });

    test('revalidates complete ancestors and keeps missing or conflicting ancestry unverified', async () => {
        const { host, current } = setup();
        const original = await parent();
        const version: WritingVersion = { ...original, generationInput: {
            schemaVersion: 2, inputPurpose: 'writing', task: { state: 'none', sources: [] },
            personal: { state: 'none' }, insights: { state: 'none' }, style: { state: 'none' },
            images: [], parent: { state: 'none' }, pagelet: { state: 'none' },
            lineage: toGenerationInputLineage(completeInputLineage([
                { kind: 'user-text', messageId: 'parent-user' },
                { kind: 'vault', path: 'private/parent.md', via: 'note' },
            ]), []),
        } };
        host.versions = { get: jest.fn(async () => version) };
        const child = v2RecoveryWithParent(version);
        const verified = await prepareWritingRecoverySources(host, child, [], 'chat', undefined, 'notes');
        expect(verified.lineageComplete).toBe(true);
        expect(host.verifyNote).toHaveBeenCalledWith({ path: 'private/parent.md' }, false);
        expect(verified.isCurrent()).toBe(true);
        current.note = false;
        expect(verified.isCurrent()).toBe(false);
        current.note = true;
        await expect(prepareWritingRecoverySources(host, child, [], 'chat', undefined, 'web'))
            .rejects.toThrow('outside current scope');

        const conflict = v2RecoveryWithParent(version, [
            { kind: 'writing-version', versionId: version.id, textHash: version.textHash },
            { kind: 'writing-version', versionId: version.id, textHash: 'b'.repeat(64) },
        ]);
        expect((await prepareWritingRecoverySources(host, conflict, [], 'chat')).lineageComplete).toBe(false);
        const wrongKind = v2RecoveryWithParent(version);
        if (wrongKind.generationInput?.schemaVersion !== 2 || wrongKind.generationInput.lineage?.state !== 'complete') {
            throw new Error('Expected complete v2 recovery fixture');
        }
        wrongKind.generationInput.lineage.dependencies[0].kind = 'personal';
        expect((await prepareWritingRecoverySources(host, wrongKind, [], 'chat')).lineageComplete).toBe(false);
        host.versions = { get: jest.fn(async () => ({ ...version, generationInput: {
            ...version.generationInput!, task: { state: 'unknown' as const, sources: [] },
        } })) };
        expect((await prepareWritingRecoverySources(host, child, [], 'chat')).lineageComplete).toBe(false);
        host.versions = { get: jest.fn(async () => original) };
        expect((await prepareWritingRecoverySources(host, child, [], 'chat')).lineageComplete).toBe(false);
    });

    test('expands a complete Writing parent chain and treats legacy, missing, and cyclic ancestry as unknown', async () => {
        const original = await parent();
        expect(writingVersionInputLineage(original).completeness).toBe('unknown');
        const source = completeInputLineage([{ kind: 'user-text', messageId: 'user-parent' },
            { kind: 'vault', path: 'private/parent.md', via: 'note' }]);
        const parentVersion: WritingVersion = { ...original, generationInput: {
            schemaVersion: 2, inputPurpose: 'writing', task: { state: 'none', sources: [] },
            lineage: toGenerationInputLineage(source, []), personal: { state: 'none' },
            insights: { state: 'none' }, style: { state: 'none' }, images: [],
            parent: { state: 'none' }, pagelet: { state: 'none' },
        } };
        const child = { ...parentVersion, id: 'child', parentVersionId: parentVersion.id,
            generationInput: { ...parentVersion.generationInput!, parent: { state: 'identified' as const,
                versionId: parentVersion.id, textHash: { algorithm: 'sha256' as const, value: parentVersion.textHash } },
                lineage: toGenerationInputLineage(completeInputLineage([
                    { kind: 'user-text', messageId: 'user-child' },
                    { kind: 'writing-version', versionId: parentVersion.id, textHash: parentVersion.textHash },
                ]), []),
            } } as WritingVersion;
        const resolved = await resolveWritingVersionInputLineage(child,
            async id => id === parentVersion.id ? parentVersion : null);
        expect(resolved).toMatchObject({ completeness: 'complete' });
        expect(resolved.dependencies).toContainEqual({ kind: 'vault', path: 'private/parent.md', via: 'note' });
        expect((await resolveWritingVersionInputLineage(child, async () => null)).completeness).toBe('unknown');
        const cyclic = { ...child, id: parentVersion.id, parentVersionId: parentVersion.id };
        expect((await resolveWritingVersionInputLineage(cyclic, async () => cyclic)).completeness).toBe('unknown');
    });
    test('keeps both observed revisions when one path supplied two different Writing inputs', () => {
        const path = 'draft/source.md';
        const lineage = toGenerationInputLineage(completeInputLineage([
            { kind: 'vault', path, via: 'note' },
        ]), [
            { purpose: 'task_material', kind: 'context-used', boundary: 'read-only-tool',
                dedupKey: 'source:A', path,
                revision: { state: 'identified', basis: 'vault_read',
                    digest: { algorithm: 'sha1', scope: 'whole_file', value: 'a'.repeat(40) } } },
            { purpose: 'task_material', kind: 'context-used', boundary: 'read-only-tool',
                dedupKey: 'source:B', path,
                revision: { state: 'identified', basis: 'vault_read',
                    digest: { algorithm: 'sha1', scope: 'whole_file', value: 'b'.repeat(40) } } },
        ]);
        expect(lineage.state).toBe('complete');
        expect(lineage.state === 'complete' ? lineage.dependencies.map(item => item.observedRevision) : [])
            .toEqual([{ state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: 'a'.repeat(40) } },
            { state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: 'b'.repeat(40) } }]);
    });
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
