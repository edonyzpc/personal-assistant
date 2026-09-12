import { GET_WRITING_CONTEXT, WritingContextRun, writingContextObservation, type PreparedWritingContext, type WritingContextRunHost } from '../src/ai-services/writing-context-run';
import { chatToolResultToPaAgentToolExecutionResult } from '../src/ai-services/pa-agent-host-tools';
import type { PaAgentMessage } from '../src/ai-services/chat-types';
import { WritingVersionService } from '../src/chat/writing-versions';
import { cloneWritingVersion, type WritingVersion } from '../src/chat/writing-types';
import type { ImageRef } from '../src/chat/image-types';

const scene = { writingTask: 'copywriting', purpose: 'social_share', audience: 'friends', domain: 'travel' };
const budget = { remainingTextChars: 4000, remainingMemoryChars: 3000 };
const ref = { assetId: 'image1', contentHash: 'a'.repeat(64) };
function observationMessage(prepared: PreparedWritingContext): PaAgentMessage {
    const result = chatToolResultToPaAgentToolExecutionResult({ type: 'toolCall', id: 'call', index: 0, name: GET_WRITING_CONTEXT, input: {} }, {
        ok: true, tool: GET_WRITING_CONTEXT, inputSummary: 'Requested writing context',
        content: writingContextObservation(prepared), sources: [],
    });
    return { role: 'toolResult', id: 'result', toolCallId: 'call', toolName: GET_WRITING_CONTEXT,
        isError: false, timestamp: 1, content: { ...result, includeInNextPrompt: true } };
}
async function setup() {
    const records = new Map<string, WritingVersion>();
    const versions = new WritingVersionService({
        getWritingVersion: async id => records.get(id) ?? null,
        putWritingVersion: async value => { records.set(value.id, cloneWritingVersion(value)); },
        listWritingVersions: async () => [...records.values()],
    });
    const parent = await versions.create({ requestId: 'parent', messageId: 'message', conversationId: 'conversation',
        turnIndex: 1, text: 'Original parent body', images: [{ ref, ordinal: 1, label: 'photo' }] });
    const state = { current: true, images: true, style: true };
    const get = jest.spyOn(versions, 'get');
    const prepare = jest.fn(async () => ({ context: 'Approved style', revisionIds: ['revision1'],
        isCurrent: () => state.style, isSourceCurrent: () => state.style }));
    const verifyImages = jest.fn(async (refs: readonly ImageRef[]) => ({
        images: refs.map((imageRef, i) => ({ ref: imageRef, ordinal: i + 1, label: 'photo' })),
        isCurrent: () => state.images,
    }));
    const host: WritingContextRunHost = { runId: 'run1', conversationId: 'conversation', candidates: [parent], versions,
        isParentCurrent: version => JSON.stringify(records.get(version.id)) === JSON.stringify(version),
        styles: { prepare }, isCurrent: () => state.current, verifyImages };
    const run = new WritingContextRun(host);
    const selection = { parentHandle: run.candidateDirectory()[0].handle, scene, currentInstructionConflicts: false, imageRefs: [ref] };
    return { run, host, selection, state, records, parent, get, prepare, verifyImages };
}

describe('host writing context preparation', () => {
    it.each(['parent', 'images', 'style'] as const)('checks real %s sources after run cleanup', async kind => {
        const f = await setup();
        f.host.verifyImages = async refs => ({ images: refs.map((value, ordinal) => ({ ref: value, ordinal, label: 'photo' })),
            isCurrent: () => f.state.current && f.state.images, isSourceCurrent: () => f.state.images });
        const controller = new AbortController();
        await f.run.prepare(f.selection, { ...budget, signal: controller.signal });
        const guard = f.run.captureSourceValidity();
        controller.abort(); f.state.current = false; f.run.dispose();
        expect(() => guard()).not.toThrow();
        if (kind === 'parent') f.records.delete(f.parent.id);
        if (kind === 'images') f.state.images = false;
        if (kind === 'style') f.state.style = false;
        expect(() => guard()).toThrow('sources changed');
        expect(() => f.run.captureSourceValidity()).toThrow();
    });

    it('does not bind an empty image/style selection to old host request callbacks', async () => {
        const f = await setup();
        f.host.styles = { prepare: async () => ({ context: '', revisionIds: [], isCurrent: () => f.state.current }) };
        await f.run.prepare({ currentInstructionConflicts: false, imageRefs: [] }, budget);
        const guard = f.run.captureSourceValidity();
        f.state.current = false; f.state.images = false; f.state.style = false; f.run.dispose();
        expect(() => guard()).not.toThrow();
    });

    it('preserves old host preparation but refuses to invent a pure image receipt', async () => {
        const f = await setup();
        await f.run.prepare(f.selection, budget);
        expect(f.run.current()).toBeDefined();
        expect(() => f.run.captureSourceValidity()).toThrow('image source receipt unavailable');
    });

    it('does not substitute a possibly run-bound legacy style callback for a source receipt', async () => {
        const f = await setup();
        f.host.styles = { prepare: async () => ({ context: 'Legacy style', revisionIds: ['old'], isCurrent: () => f.state.current }) };
        await f.run.prepare({ currentInstructionConflicts: false, imageRefs: [] }, budget);
        expect(f.run.current()).toBeDefined();
        expect(() => f.run.captureSourceValidity()).toThrow('style source receipt unavailable');
    });

    it('marks an explicitly selected authorized candidate without exposing the persistent ID', async () => {
        const f = await setup();
        const run = new WritingContextRun({ ...f.host, selectedParentVersionId: f.parent.id });
        expect(run.candidateDirectory()).toEqual([{ handle: 'run1:parent:1', messageId: f.parent.messageId,
            turnIndex: f.parent.turnIndex, selected: true }]);
        expect(JSON.stringify(run.candidateDirectory())).not.toContain(f.parent.id);
        run.dispose(); f.run.dispose();
    });
    it.each(['parent', 'images', 'style', 'replacement'] as const)('withdraws canonical writing observations and invalidates physical snapshots after %s changes', async kind => {
        const f = await setup();
        const prepared = await f.run.prepare(f.selection, budget);
        const result = observationMessage(prepared);
        const independent: PaAgentMessage = { role: 'user', id: 'user', content: 'Keep the second proposal', timestamp: 1 };
        const original = [independent, result];
        const before = JSON.stringify(original);
        expect(await f.run.projectTranscript(original)).toEqual(original);
        const assertCurrent = f.run.captureTranscriptValidity(original);
        assertCurrent();
        if (kind === 'parent') f.records.delete(f.parent.id);
        else if (kind === 'images') f.state.images = false;
        else if (kind === 'style') f.state.style = false;
        else await f.run.prepare({ currentInstructionConflicts: false, imageRefs: [] }, budget);
        expect(assertCurrent).toThrow();
        const projected = await f.run.projectTranscript(original);
        const payload = JSON.stringify(projected);
        expect(payload).not.toContain('Original parent body');
        expect(payload).not.toContain('Approved style');
        expect(payload).not.toContain('image1');
        expect(projected[0]).toEqual(independent);
        expect(JSON.stringify(original)).toBe(before);
        expect(() => f.run.captureTranscriptValidity(projected)()).not.toThrow();
    });

    it('rejects mismatched observation text even when it carries the current handle', async () => {
        const f = await setup();
        const prepared = await f.run.prepare(f.selection, budget);
        const message = observationMessage(prepared);
        if (message.role !== 'toolResult') throw new Error('Expected tool result');
        message.content.promptText = message.content.promptText.replace('Original parent body', 'Injected parent body');
        expect(() => f.run.captureTranscriptValidity([message])).toThrow();
        expect(JSON.stringify(await f.run.projectTranscript([message]))).not.toContain('Injected parent body');
    });

    it.each(['input', 'extra'])('rejects unverified canonical envelope %s while the inner observation is valid', async key => {
        const f = await setup();
        const prepared = await f.run.prepare(f.selection, budget);
        const message = observationMessage(prepared);
        if (message.role !== 'toolResult') throw new Error('Expected tool result');
        const payload = JSON.parse(message.content.promptText);
        payload[key] = 'REVOKED_ENVELOPE_TEXT';
        message.content.promptText = JSON.stringify(payload);
        expect(() => f.run.captureTranscriptValidity([message])).toThrow();
        expect(JSON.stringify(await f.run.projectTranscript([message]))).not.toContain('REVOKED_ENVELOPE_TEXT');
    });

    it('projects the same cloned observation that was verified before an asynchronous parent lookup', async () => {
        const f = await setup();
        const prepared = await f.run.prepare(f.selection, budget);
        const message = observationMessage(prepared);
        if (message.role !== 'toolResult') throw new Error('Expected tool result');
        f.get.mockImplementationOnce(async () => {
            message.content.promptText = message.content.promptText.replace('Original parent body', 'CHANGED_DURING_WAIT');
            return f.parent;
        });
        const projected = await f.run.projectTranscript([message]);
        expect(JSON.stringify(projected)).not.toContain('CHANGED_DURING_WAIT');
        expect(JSON.stringify(projected)).toContain('Original parent body');
        expect(() => f.run.captureTranscriptValidity(projected)()).not.toThrow();
        expect(() => f.run.captureTranscriptValidity([message])).toThrow();
    });

    it('propagates cancellation during projection instead of treating it as a source withdrawal', async () => {
        const f = await setup();
        const prepared = await f.run.prepare(f.selection, budget);
        const controller = new AbortController();
        f.get.mockImplementationOnce(async () => { controller.abort(); return f.parent; });
        await expect(f.run.projectTranscript([observationMessage(prepared)], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    });
    it('binds a candidate and full image selection, passes semantic scene and host budget, and returns isolated snapshots', async () => {
        const f = await setup();
        const prepared = await f.run.prepare({ ...f.selection, currentInstructionConflicts: true, imageRefs: [] }, budget);
        expect(prepared.parent?.text).toBe(f.parent.text);
        expect(prepared.images).toEqual([]);
        expect(f.prepare).toHaveBeenCalledWith(scene, { ...budget, remainingTextChars: expect.any(Number), currentInstructionConflicts: true });
        prepared.parent!.text = 'mutated';
        prepared.styleRevisionIds.push('invented');
        const validated = await f.run.validate(prepared.handle);
        expect(validated.parent?.text).toBe(f.parent.text);
        expect(validated.styleRevisionIds).toEqual(['revision1']);
    });

    it('rejects unknown parent handles and cross-conversation candidates without version or image reads', async () => {
        const f = await setup();
        await expect(f.run.prepare({ ...f.selection, parentHandle: f.parent.id }, budget)).rejects.toThrow('Unknown writing parent');
        expect(f.get).not.toHaveBeenCalled(); expect(f.verifyImages).not.toHaveBeenCalled();
        expect(() => new WritingContextRun({ ...f.host, candidates: [{ ...f.parent, conversationId: 'other' }] })).toThrow('outside conversation');
    });

    it('allows a new topic without parent and replaces only previously successful handles', async () => {
        const f = await setup();
        const first = await f.run.prepare(f.selection, budget);
        await expect(f.run.prepare({ ...f.selection, scene: {} }, budget)).rejects.toThrow('Invalid writing scene');
        expect((await f.run.validate(first.handle)).parent?.id).toBe(f.parent.id);
        const next = await f.run.prepare({ currentInstructionConflicts: false, imageRefs: [] }, budget);
        expect(next.parent).toBeUndefined();
        await expect(f.run.validate(first.handle)).rejects.toThrow('Unknown writing context');
        expect(f.prepare).toHaveBeenLastCalledWith(undefined, { ...budget, remainingTextChars: expect.any(Number), currentInstructionConflicts: false });
    });

    it.each(['parent', 'images', 'style', 'session', 'dispose'] as const)('rejects invalidated context before consumption: %s', async kind => {
        const f = await setup();
        const prepared = await f.run.prepare(f.selection, budget);
        if (kind === 'parent') f.records.get(f.parent.id)!.text = 'Changed parent';
        else if (kind === 'images') f.state.images = false;
        else if (kind === 'style') f.state.style = false;
        else if (kind === 'session') f.state.current = false;
        else f.run.dispose();
        await expect(f.run.validate(prepared.handle)).rejects.toThrow();
    });

    it('rechecks parent and material sources after style preparation waits', async () => {
        const f = await setup();
        f.prepare.mockImplementation(async () => {
            f.state.images = false;
            return { context: 'style', revisionIds: [], isCurrent: () => true, isSourceCurrent: () => true };
        });
        await expect(f.run.prepare(f.selection, budget)).rejects.toThrow('sources changed');
    });

    it.each(['cancel', 'session'] as const)('stops before style preparation after image verification loses %s', async kind => {
        const f = await setup();
        const controller = new AbortController();
        f.verifyImages.mockImplementation(async refs => {
            if (kind === 'cancel') controller.abort();
            else f.state.current = false;
            return { images: refs.map((imageRef, i) => ({ ref: imageRef, ordinal: i + 1, label: 'photo' })), isCurrent: () => true };
        });
        await expect(f.run.prepare(f.selection, { ...budget, signal: controller.signal })).rejects.toThrow();
        expect(f.prepare).not.toHaveBeenCalled();
    });

    it('rejects a host image verification result that silently adds parent images', async () => {
        const f = await setup();
        f.verifyImages.mockImplementation(async () => ({ images: f.parent.associatedImages, isCurrent: () => true }));
        await expect(f.run.prepare({ ...f.selection, imageRefs: [] }, budget)).rejects.toThrow('materials changed');
        expect(f.prepare).not.toHaveBeenCalled();
    });

    it('does not let an older preparation finish over a newer context', async () => {
        const f = await setup();
        let started!: () => void, resume!: () => void;
        const waiting = new Promise<void>(resolve => { started = resolve; });
        const release = new Promise<void>(resolve => { resume = resolve; });
        f.prepare.mockImplementationOnce(async () => {
            started(); await release;
            return { context: 'old', revisionIds: [], isCurrent: () => true, isSourceCurrent: () => true };
        });
        const old = f.run.prepare(f.selection, budget);
        const rejected = expect(old).rejects.toThrow('superseded');
        await waiting;
        const current = await f.run.prepare({ currentInstructionConflicts: false, imageRefs: [] }, budget);
        resume(); await rejected;
        expect((await f.run.validate(current.handle)).parent).toBeUndefined();
    });
});
