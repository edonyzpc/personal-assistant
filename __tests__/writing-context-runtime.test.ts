import { AIMessageChunk } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIUtils } from '../src/ai-services/ai-utils';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import type { LegacyAgentEvent } from '../src/ai-services/chat-types';
import { PaAgentRuntime } from '../src/ai-services/pa-agent-runtime';
import { WritingVersionService } from '../src/chat/writing-versions';
import { cloneWritingVersion, type WritingVersion } from '../src/chat/writing-types';
import type { ImageAssetService } from '../src/chat/image-assets';
import type { MessageImage } from '../src/chat/image-types';

jest.mock('obsidian');
afterEach(() => jest.restoreAllMocks());

const scene = { writingTask: 'email', purpose: 'invitation', audience: 'colleagues', domain: 'work' };
const body = '  请来参加周五的分享。\n🌱\n';
type Scenario = 'complete' | 'ordinary' | 'premature' | 'mixed' | 'revoked' | 'physical-retry' | 'image-subset' | 'image-empty' | 'schema-repair' | 'reselect' | 'personal-source' | 'personal-retry' | 'incomplete';

async function runScenario(scenario: Scenario) {
    const records = new Map<string, WritingVersion>();
    const versions = new WritingVersionService({
        getWritingVersion: async id => records.get(id) ?? null,
        putWritingVersion: async version => { records.set(version.id, cloneWritingVersion(version)); },
        listWritingVersions: async () => [...records.values()],
    });
    const parent = await versions.create({ requestId: 'earlier', conversationId: 'conversation', messageId: 'earlier-message',
        turnIndex: 1, text: 'Authorized parent draft', images: [] });
    let styleCurrent = true;
    let personalCurrent = true;
    const images: MessageImage[] = [1, 2].map(ordinal => ({ ref: { assetId: `photo-${ordinal}`, contentHash: String(ordinal).repeat(64) }, ordinal, label: `Photo ${ordinal}` }));
    const imageMode = scenario === 'image-subset' || scenario === 'image-empty';
    const release = jest.fn();
    const imageService = {
        verify: jest.fn(async () => ({ asset: {}, isCurrent: () => true })),
        resolveVariant: jest.fn(async (ref: MessageImage['ref']) => ({
            blob: new Blob([new Uint8Array([ref.assetId === 'photo-1' ? 1 : 2])]), mime: 'image/jpeg',
            width: 1, height: 1, persistent: true, release,
        })),
    };
    const prepareStyle = jest.fn(async () => ({ context: 'Authorized concise style', revisionIds: ['style-1'],
        isCurrent: () => styleCurrent, isSourceCurrent: () => styleCurrent }));
    const host = {
        settings: { debug: false, aiProvider: 'openai', baseURL: 'https://writing.invalid/v1', chatModelName: 'fixture',
            policyModelName: '', skillContextEnabled: false, enabledSkillIds: [], webSearchEnabled: false,
            memoryEnabled: false, licenseTier: 'free', statisticsVaultId: 'fixture',
            retrievalOptimizationFlags: { lexicalProfile: false, strictReranker: false, graphPpr: false, relaxedRecovery: false } },
        app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null, cachedRead: async () => '' },
            metadataCache: { getFileCache: () => null } },
        memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }), searchHybrid: async () => [], getChunksByPath: async () => [] },
        getAPIToken: async () => 'fixture', log: jest.fn(), isOperationsAgentEnabled: false,
        getMemoryExtractionPromptContext: () => {
            if (scenario !== 'personal-source' && scenario !== 'personal-retry') return undefined;
            return Object.defineProperty({ memoryContextMode: 'governed', governedMemoryContext: 'Authorized personal background' },
                'isSourceCurrent', { value: () => personalCurrent });
        },
    } as unknown as AiServiceHost;
    const ai = new AIUtils(host);
    const events: LegacyAgentEvent[] = [];
    const inputs: string[] = [];
    const serializedInputs: string[] = [];
    const schemas: Array<Array<{ function: { name: string; parameters: unknown } }>> = [];
    const retryErrors: unknown[] = [];
    const createModel = jest.spyOn(ai, 'createChatModel').mockImplementation(async (_temperature, options) => {
        const model = RunnableLambda.from(async function* (input: unknown) {
            options?.onProviderRequestStart?.();
            const text = String(input);
            inputs.push(text);
            serializedInputs.push(JSON.stringify(input));
            const turn = inputs.length;
            if (scenario === 'ordinary') {
                yield new AIMessageChunk({ content: 'We can discuss the options first.' });
                yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'stop' } });
                return;
            }
            if ((turn === 1 || (turn === 2 && scenario === 'schema-repair') || (scenario === 'reselect' && turn <= 3)) && scenario !== 'premature') {
                const parentHandle = text.match(/"handle":"([^"]+:parent:1)"/)?.[1];
                if (!parentHandle) throw new Error('Missing authorized parent directory');
                const selectedScene = scenario === 'reselect' && turn === 2 ? { ...scene, purpose: 'reminder' } : scene;
                const selection = { parentHandle, scene: scenario === 'schema-repair' && turn === 1 ? JSON.stringify(scene) : selectedScene, currentInstructionConflicts: false,
                    imageRefs: scenario === 'image-subset' ? [images[1].ref] : [] };
                yield new AIMessageChunk({ content: '', tool_call_chunks: [
                    ...(scenario === 'schema-repair' && turn === 1 ? [{ id: 'scope', index: 0, name: 'declare_source_scope',
                        args: JSON.stringify({ instructionQuote: 'Use the earlier proposal for an invitation', notes: 'none', webAllowed: false }) }] : []),
                    { id: `prepare-${turn}`, index: scenario === 'schema-repair' && turn === 1 ? 1 : 0,
                        name: 'get_writing_context', args: JSON.stringify(selection) },
                    ...(scenario === 'mixed' ? [{ id: 'output', index: 1, name: 'present_writing',
                        args: JSON.stringify({ contextHandle: 'request', body }) }] : []),
                ] });
            } else {
                const handle = text.match(/"contextHandle":\s*"([^"]+:writing:\d+)"/)?.[1] ?? 'request';
                if (scenario === 'physical-retry') {
                    styleCurrent = false;
                    try { options?.onProviderRequestStart?.(); } catch (error) { retryErrors.push(error); }
                }
                if (scenario === 'personal-retry') {
                    personalCurrent = false;
                    try { options?.onProviderRequestStart?.(); } catch (error) { retryErrors.push(error); }
                }
                yield new AIMessageChunk({ content: '', tool_call_chunks: [{ id: 'output', index: 0,
                    name: 'present_writing', args: JSON.stringify({ contextHandle: handle, body, explanation: '' }) }] });
                if (scenario === 'revoked') styleCurrent = false;
            }
            yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: scenario === 'incomplete' && turn === 2 ? 'length' : 'tool_calls' } });
        });
        Object.assign(model, { bindTools: (bound: typeof schemas[number]) => { schemas.push(bound); return model; } });
        return model as unknown as Awaited<ReturnType<AIUtils['createChatModel']>>;
    });
    const runtime = new PaAgentRuntime(host, ai, { skillContextProvider: null });
    let error: unknown;
    try {
        await runtime.streamTurn({ prompt: 'Use the earlier proposal for an invitation', memoryMode: 'auto',
            writingRequest: { requestId: 'request' }, writingOutputProtocol: 'native',
            ...(imageMode ? { images, imageAssetService: imageService as unknown as ImageAssetService,
                imageCapability: { get: () => 'supported' as const, onSuccess: jest.fn(), onError: jest.fn() } } : {}),
            writingContextHost: { conversationId: 'conversation', candidates: [parent], versions,
                styles: { prepare: prepareStyle }, isCurrent: () => true,
                isParentCurrent: version => JSON.stringify(records.get(version.id)) === JSON.stringify(version) },
            onEvent: event => events.push(event) });
    } catch (caught) { error = caught; }
    finally { runtime.dispose(); versions.dispose(); }
    return { events, inputs, serializedInputs, images, schemas, prepareStyle, createModel, error, retryErrors,
        revokeStyle: () => { styleCurrent = false; }, revokePersonal: () => { personalCurrent = false; } };
}

describe('native writing context runtime integration', () => {
    it('keeps a non-enumerable Personal source receipt across style projection and runtime cleanup', async () => {
        const result = await runScenario('personal-source');
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> => event.kind === 'writing-artifact');
        expect(result.inputs[1]).toContain('Authorized personal background');
        expect(result.inputs.join('')).not.toContain('isSourceCurrent');
        expect(artifact?.isSourceCurrent?.()).toBe(true);
        result.revokePersonal();
        expect(artifact?.isSourceCurrent?.()).toBe(false);
    });

    it('rejects a physical retry after Personal authority changes even with identical background text', async () => {
        const result = await runScenario('personal-retry');
        expect(result.retryErrors).toHaveLength(1);
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
    });
    it('delivers a source receipt that survives runtime cleanup but rejects a later style revocation', async () => {
        const result = await runScenario('complete');
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> => event.kind === 'writing-artifact');
        expect(artifact?.isSourceCurrent?.()).toBe(true);
        expect(JSON.stringify(artifact)).not.toContain('isSourceCurrent');
        result.revokeStyle();
        expect(artifact?.isSourceCurrent?.()).toBe(false);
    });
    it('reprepares an earlier selection through the runtime wrappers after another context replaces it', async () => {
        const result = await runScenario('reselect');
        expect(result.error).toBeUndefined();
        expect(result.inputs).toHaveLength(4);
        expect(result.prepareStyle).toHaveBeenCalledTimes(3);
        expect(result.events.filter(event => event.kind === 'writing-artifact')).toEqual([
            expect.objectContaining({ body, writingContext: expect.objectContaining({ scene }) }),
        ]);
    });
    it('allows one correction of a rejected scene object before presenting the work', async () => {
        const result = await runScenario('schema-repair');
        expect(result.error).toBeUndefined();
        expect(result.inputs).toHaveLength(3);
        expect(result.schemas[1].map(schema => schema.function.name)).toContain('get_writing_context');
        expect(result.prepareStyle).toHaveBeenCalledTimes(1);
        expect(result.events.filter(event => event.kind === 'writing-artifact')).toEqual([
            expect.objectContaining({ body, styleRevisionIds: ['style-1'] }),
        ]);
    });
    it('prepares with the main Agent, then binds one final output to that receipt without acknowledgement', async () => {
        const result = await runScenario('complete');
        expect(result.error).toBeUndefined();
        expect(result.inputs).toHaveLength(2);
        expect(result.createModel).toHaveBeenCalledTimes(2);
        expect(result.schemas[0].map(schema => schema.function.name)).toContain('get_writing_context');
        expect(result.schemas[0].map(schema => schema.function.name)).not.toContain('present_writing');
        expect(result.schemas[1].map(schema => schema.function.name)).toContain('present_writing');
        expect(result.inputs[0]).toContain('Before presenting writing, call get_writing_context');
        expect(result.inputs[1]).toContain('Writing context preparation is complete');
        expect(result.inputs[1]).not.toContain('Before presenting writing, call get_writing_context');
        expect(result.schemas[1].map(schema => schema.function.name)).toContain('get_writing_context');
        expect(result.inputs[0]).not.toContain('Authorized parent draft');
        expect(result.inputs[1]).toContain('Authorized parent draft');
        expect(result.inputs[1]).toContain('Authorized concise style');
        expect(result.prepareStyle).toHaveBeenCalledTimes(1);
        expect(result.prepareStyle.mock.calls[0]).toEqual([scene, expect.objectContaining({ currentInstructionConflicts: false })]);
        expect(result.events.filter(event => event.kind === 'writing-artifact')).toEqual([
            expect.objectContaining({ body, requestId: 'request', styleRevisionIds: ['style-1'], associatedImages: [],
                writingContext: { parentVersionId: expect.any(String), scene } }),
        ]);
        expect(result.events.some(event => event.kind === 'writing-recovery')).toBe(false);
    });

    it.each(['image-subset', 'image-empty'] as const)('removes excluded pixels from the actual generation input for %s', async scenario => {
        const result = await runScenario(scenario);
        expect(result.error).toBeUndefined();
        expect(result.serializedInputs).toHaveLength(2);
        expect(result.serializedInputs[0]).toContain('data:image/jpeg;base64,AQ==');
        expect(result.serializedInputs[0]).toContain('data:image/jpeg;base64,Ag==');
        expect(result.serializedInputs[1]).not.toContain('data:image/jpeg;base64,AQ==');
        if (scenario === 'image-subset') expect(result.serializedInputs[1]).toContain('data:image/jpeg;base64,Ag==');
        else expect(result.serializedInputs[1]).not.toContain('data:image/jpeg;base64,');
        expect(result.events.find(event => event.kind === 'writing-artifact')).toMatchObject({
            associatedImages: scenario === 'image-subset' ? [result.images[1]] : [],
        });
    });

    it('keeps the incomplete output source receipt after cleanup and rejects later revocation', async () => {
        const result = await runScenario('incomplete');
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
        const recovery = result.events.find(event => event.kind === 'writing-recovery');
        expect(recovery?.rawText).toContain('请来参加周五的分享');
        expect(recovery?.isSourceCurrent?.()).toBe(true);
        expect(JSON.stringify(recovery)).not.toContain('isSourceCurrent');
        result.revokeStyle();
        expect(recovery?.isSourceCurrent?.()).toBe(false);
    });

    it('allows ordinary discussion without preparing a context or creating a version', async () => {
        const result = await runScenario('ordinary');
        expect(result.error).toBeUndefined();
        expect(result.inputs).toHaveLength(1);
        expect(result.prepareStyle).not.toHaveBeenCalled();
        expect(result.events.some(event => event.kind === 'writing-artifact' || event.kind === 'writing-recovery')).toBe(false);
    });

    it.each(['premature', 'mixed'] as const)('rejects %s output without executing a context preparation', async scenario => {
        const result = await runScenario(scenario);
        expect(result.inputs).toHaveLength(1);
        expect(result.prepareStyle).not.toHaveBeenCalled();
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
    });

    it.each(['revoked', 'physical-retry'] as const)('rejects stale style at %s while retaining the original request identity', async scenario => {
        const result = await runScenario(scenario);
        expect(result.inputs).toHaveLength(2);
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
        const recovery = result.events.find(event => event.kind === 'writing-recovery');
        expect(recovery).toMatchObject({ requestId: 'request', reason: 'source_changed', rawText: '' });
        if (scenario === 'physical-retry') expect(result.retryErrors).toHaveLength(1);
    });
});
