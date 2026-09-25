import { AIMessageChunk } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { AIUtils } from '../src/ai-services/ai-utils';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import type { AgentEvent, LegacyAgentEvent } from '../src/ai-services/chat-types';
import { PaAgentRuntime } from '../src/ai-services/pa-agent-runtime';
import { runProviderAdmission } from '../src/ai-services/provider-admission-error';
import { WritingVersionService } from '../src/chat/writing-versions';
import { cloneWritingVersion, type WritingVersion } from '../src/chat/writing-types';
import { completeInputLineage, generationInputSnapshotInputLineage,
    toGenerationInputLineage } from '../src/ai-services/input-lineage';
import type { GenerationInputTaskSourceV2 } from '../src/ai-services/generation-input-snapshot';
import type { ImageAssetService } from '../src/chat/image-assets';
import type { MessageImage } from '../src/chat/image-types';
import type { PageletChatHandoffContext } from '../src/ai-services/pagelet-handoff';

jest.mock('obsidian');
afterEach(() => jest.restoreAllMocks());

const scene = { writingTask: 'email', purpose: 'invitation', audience: 'colleagues', domain: 'work' };
const body = '  请来参加周五的分享。\n🌱\n';
type Scenario = 'complete' | 'ordinary' | 'reported-incomplete' | 'premature' | 'mixed' | 'revoked' | 'physical-retry' | 'image-subset' | 'image-empty' | 'schema-repair' | 'reselect' | 'repeat-selection' | 'new-topic' | 'personal-source' | 'personal-retry' | 'pagelet' | 'incomplete' | 'stale-insights';

async function runScenario(scenario: Scenario | 'ordinary-revoked', debug = false, backgroundAdmission?: {
    change: 'live-refresh' | 'revoked-same-text' | 'unguarded-refresh'; writing: boolean;
}, scopedParentScope?: 'notes' | 'web') {
    const records = new Map<string, WritingVersion>();
    const versions = new WritingVersionService({
        getWritingVersion: async id => records.get(id) ?? null,
        putWritingVersion: async version => { records.set(version.id, cloneWritingVersion(version)); },
        listWritingVersions: async () => [...records.values()],
    });
    const parentSourcePath = 'notes/PARENT_SOURCE.md';
    const parentSourceFile = { path: parentSourcePath, extension: 'md', stat: { ctime: 1, mtime: 1, size: 1 } };
    let parentSourceLive = true;
    let parentPermission = true;
    let scopeCurrent = true;
    const parentTaskSource: GenerationInputTaskSourceV2 = { purpose: 'task_material', kind: 'context-used',
        boundary: 'read-only-tool', dedupKey: 'parent-source', path: parentSourcePath,
        revision: { state: 'identified', basis: 'vault_read',
            digest: { algorithm: 'sha1', scope: 'whole_file', value: 'a'.repeat(40) } } };
    const parentLineage = completeInputLineage([{ kind: 'user-text', messageId: 'earlier-message' },
        { kind: 'vault', path: parentSourcePath, via: 'note' }]);
    const parent = await versions.create({ requestId: 'earlier', conversationId: 'conversation', messageId: 'earlier-message',
        turnIndex: 1, text: 'Authorized parent draft', images: [],
        ...(scopedParentScope ? { generationInput: { schemaVersion: 2 as const, inputPurpose: 'writing' as const,
            task: { state: 'identified' as const, sources: [parentTaskSource] },
            personal: { state: 'none' as const }, insights: { state: 'none' as const },
            style: { state: 'none' as const }, images: [], parent: { state: 'none' as const },
            pagelet: { state: 'none' as const },
            lineage: toGenerationInputLineage(parentLineage, [parentTaskSource]) } } : {}) });
    let styleCurrent = true;
    let personalCurrent = scenario !== 'stale-insights';
    let backgroundUpdated = false;
    let backgroundText = 'Authorized personal background';
    const images: MessageImage[] = [1, 2].map(ordinal => ({ ref: { assetId: `photo-${ordinal}`, contentHash: String(ordinal).repeat(64) }, ordinal, label: `Photo ${ordinal}` }));
    const pagelet: PageletChatHandoffContext = { version: 1, id: 'pagelet-1', body: 'Source-backed handoff',
        anchor: { path: 'notes/anchor.md', mtime: 10, size: 20, contentHash: 'a'.repeat(64) },
        sources: [{ path: 'notes/source.md', mtime: 30, size: 40, contentHash: 'b'.repeat(64) }],
        sourceRefs: [{ path: 'notes/source.md' }], webUrls: [], whyNow: ['Relevant now'],
        triggerReason: 'manual', preparedAt: 1, pipelineVersion: 'pagelet-v1' };
    const imageMode = scenario === 'image-subset' || scenario === 'image-empty';
    const release = jest.fn();
    let imageCurrent = true;
    const imageService = {
        verify: jest.fn(async () => ({ asset: {}, isCurrent: () => imageCurrent })),
        resolveVariant: jest.fn(async (ref: MessageImage['ref']) => ({
            blob: new Blob([new Uint8Array([ref.assetId === 'photo-1' ? 1 : 2])]), mime: 'image/jpeg',
            width: 1, height: 1, persistent: true, release,
        })),
    };
    const prepareStyle = jest.fn(async () => ({ context: 'Authorized concise style', revisionIds: ['style-1'],
        isCurrent: () => styleCurrent, isSourceCurrent: () => styleCurrent }));
    const host = {
        settings: { debug, aiProvider: 'openai', baseURL: 'https://writing.invalid/v1', chatModelName: 'fixture',
            policyModelName: '', skillContextEnabled: false, enabledSkillIds: [], webSearchEnabled: false,
            memoryEnabled: false, licenseTier: 'free', statisticsVaultId: 'fixture',
            retrievalOptimizationFlags: { lexicalProfile: false, strictReranker: false, graphPpr: false, relaxedRecovery: false } },
        app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: (path: string) =>
                path === parentSourcePath && parentSourceLive ? parentSourceFile : null, cachedRead: async () => '' },
            metadataCache: { getFileCache: () => null } },
        memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }), searchHybrid: async () => [], getChunksByPath: async () => [] },
        getAPIToken: async () => 'fixture', log: jest.fn(), isOperationsAgentEnabled: false,
        isDataBoundaryAllowedPath: (path: string) => path !== parentSourcePath || parentPermission,
        captureWritingStyleSourceValidity: async () => ({ isCurrent: () => styleCurrent }),
        getMemoryExtractionPromptContext: () => {
            if (!backgroundAdmission && scenario !== 'personal-source' && scenario !== 'personal-retry' && scenario !== 'stale-insights' && scenario !== 'ordinary-revoked') return undefined;
            const context = { memoryContextMode: 'governed', governedMemoryContext: backgroundText };
            Object.defineProperties(context, {
                ...(backgroundAdmission?.change === 'unguarded-refresh' ? {} : {
                    isSourceCurrent: { value: backgroundUpdated ? () => true : () => personalCurrent },
                }),
                generationInputSources: { value: scenario === 'stale-insights'
                    ? { personal: { state: 'none' }, insights: { state: 'unknown', mode: 'governed' } }
                    : { personal: { state: 'identified', mode: 'governed',
                    revisions: [{ claimId: 'claim-1', revisionId: 'revision-1' }] }, insights: { state: 'none' } } },
            });
            return context;
        },
    } as unknown as AiServiceHost;
    const ai = new AIUtils(host);
    const events: LegacyAgentEvent[] = [];
    const lifecycle: AgentEvent[] = [];
    const inputs: string[] = [];
    const serializedInputs: string[] = [];
    const schemas: Array<Array<{ function: { name: string; parameters: unknown } }>> = [];
    const retryErrors: unknown[] = [];
    const createModel = jest.spyOn(ai, 'createChatModel').mockImplementation(async (_temperature, options) => {
        const model = RunnableLambda.from(async function* (input: unknown) {
            if (backgroundAdmission && !backgroundUpdated) {
                backgroundUpdated = true;
                if (backgroundAdmission.change === 'revoked-same-text') personalCurrent = false;
                else backgroundText = 'Refreshed personal background';
            }
            // Exercise the actual runtime dispatch callback after serialization,
            // with the same local-admission wrapper used by both transports.
            if (backgroundAdmission) runProviderAdmission(options?.onProviderRequestStart);
            else options?.onProviderRequestStart?.();
            const text = String(input);
            inputs.push(text);
            serializedInputs.push(JSON.stringify(input));
            const turn = inputs.length;
            if (scenario === 'reported-incomplete') {
                yield new AIMessageChunk({ content: '', tool_call_chunks: [{ id: 'report', index: 0,
                    name: 'report_task_incomplete', args: JSON.stringify({ answer: 'I cannot complete this writing task.' }) }] });
                yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'tool_calls' } });
                return;
            }
            if (scenario === 'ordinary' || scenario === 'ordinary-revoked') {
                yield new AIMessageChunk({ content: 'We can discuss the options first.' });
                yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: 'stop' } });
                return;
            }
            if ((turn === 1 || (turn === 2 && scenario === 'schema-repair')
                || (scenario === 'reselect' && turn <= 3)
                || (scenario === 'repeat-selection' && turn <= 4)) && scenario !== 'premature') {
                const parentHandle = text.match(/"handle":"([^"]+:parent:1)"/)?.[1];
                if (!parentHandle) throw new Error('Missing authorized parent directory');
                const selectedScene = scenario === 'reselect' && turn === 2 ? { ...scene, purpose: 'reminder' } : scene;
                const selection = { parentHandle: scenario === 'new-topic' ? null : parentHandle,
                    scene: scenario === 'schema-repair' && turn === 1 ? JSON.stringify(scene) : selectedScene, currentInstructionConflicts: false,
                    imageRefs: scenario === 'image-subset' ? [images[1].ref] : [] };
                yield new AIMessageChunk({ content: '', tool_call_chunks: [
                    { id: `prepare-${turn}`, index: 0,
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
            yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: scenario === 'incomplete' ? 'length' : 'tool_calls' } });
        });
        Object.assign(model, { bindTools: (bound: typeof schemas[number]) => { schemas.push(bound); return model; } });
        return model as unknown as Awaited<ReturnType<AIUtils['createChatModel']>>;
    });
    const runtime = new PaAgentRuntime(host, ai, { skillContextProvider: null });
    let error: unknown;
    try {
        await runtime.streamTurn({ prompt: 'Use the earlier proposal for an invitation', memoryMode: 'auto',
            isCurrent: () => scopeCurrent,
            writingRequest: backgroundAdmission?.writing === false ? undefined : { requestId: 'request' },
            writingOutputProtocol: backgroundAdmission?.writing === false ? undefined : 'native',
            ...(scenario === 'pagelet' ? { pageletHandoff: pagelet } : {}),
            ...(scenario === 'new-topic' ? { writingContext: { parentVersionId: parent.id, text: parent.text,
                textHash: parent.textHash, associatedImages: [] } } : {}),
            ...(scopedParentScope ? { runSourceSelection: { schemaVersion: 1 as const, scope: scopedParentScope,
                selectionId: 'writing-parent-scope', userMessageId: 'writing-parent-user' } } : {}),
            ...(imageMode ? { images, imageAssetService: imageService as unknown as ImageAssetService,
                imageCapability: { get: () => 'supported' as const, onSuccess: jest.fn(), onError: jest.fn() } } : {}),
            writingContextHost: backgroundAdmission?.writing === false ? undefined : { conversationId: 'conversation', candidates: [parent], versions,
                styles: { prepare: prepareStyle }, isCurrent: () => true,
                isParentCurrent: version => JSON.stringify(records.get(version.id)) === JSON.stringify(version),
                isParentSourceCurrent: version => JSON.stringify(records.get(version.id)) === JSON.stringify(version) },
            onEvent: event => {
                events.push(event);
                if (scenario === 'ordinary-revoked' && event.kind === 'writing-preview' && event.text) personalCurrent = false;
            }, onLifecycleEvent: event => lifecycle.push(event) });
    } catch (caught) { error = caught; }
    finally { runtime.dispose(); versions.dispose(); }
    return { events, lifecycle, inputs, serializedInputs, images, pagelet, parent, schemas, prepareStyle, createModel, error, retryErrors, log: host.log as jest.Mock,
        revokeStyle: () => { styleCurrent = false; }, revokePersonal: () => { personalCurrent = false; },
        revokeImage: () => { imageCurrent = false; },
        revokeParentSource: () => { parentSourceLive = false; }, revokeParentPermission: () => { parentPermission = false; },
        revokeScope: () => { scopeCurrent = false; },
        setDebug: (enabled: boolean) => { host.settings.debug = enabled; } };
}

describe('native writing context runtime integration', () => {
    it.each([true, false])('keeps the serialized background when its captured receipt remains valid (writing=%s)', async writing => {
        const result = await runScenario('ordinary', false, { change: 'live-refresh', writing });
        expect(result.inputs).toHaveLength(1);
        expect(result.inputs[0]).toContain('Authorized personal background');
        expect(result.inputs[0]).not.toContain('Refreshed personal background');
        expect(result.lifecycle.find(event => event.type === 'agent_end')).toMatchObject({ status: 'completed' });
        expect(result.createModel).toHaveBeenCalledTimes(1);
    });

    it.each([
        { change: 'revoked-same-text' as const, writing: true },
        { change: 'revoked-same-text' as const, writing: false },
        { change: 'unguarded-refresh' as const, writing: true },
        { change: 'unguarded-refresh' as const, writing: false },
    ])('rejects changed background authority without sending or fallback: $change / writing=$writing', async input => {
        const result = await runScenario('ordinary', false, input);
        expect(result.inputs).toHaveLength(0);
        expect(result.lifecycle.find(event => event.type === 'agent_end')).toMatchObject({ status: 'error' });
        expect(result.createModel).toHaveBeenCalledTimes(1);
    });

    it('traces stale background rejection before sending ordinary Chat through the native writing entry', async () => {
        const result = await runScenario('stale-insights', true);
        const traces = result.log.mock.calls.filter(([message]) => message === 'PA Agent trace').map(([, fields]) => fields);
        expect(traces).toContainEqual(expect.objectContaining({ phase: 'llm_stream:error',
            errorType: 'ProviderAdmissionError', localReason: 'personal_context_changed', turnId: 'turn_1' }));
        expect(result.inputs).toHaveLength(0);
        expect(traces.some(trace => trace.phase === 'http_dispatch')).toBe(false);
        expect(JSON.stringify(traces)).not.toContain('Authorized personal background');
    });

    it('keeps the installed HTTP hook silent until Debug is enabled and stops it again when disabled', async () => {
        const result = await runScenario('ordinary');
        expect(result.inputs).toHaveLength(1);
        const options = result.createModel.mock.calls[0][1]!;
        const event = { requestId: 'dynamic-hook', phase: 'http_dispatch' as const, transport: 'native' as const,
            timestamp: 1, elapsedMs: 0 };
        expect(options.isProviderRequestTraceEnabled?.()).toBe(false);
        options.onProviderRequestTrace?.(event);
        expect(result.log.mock.calls.some(([message]) => message === 'PA Agent trace')).toBe(false);
        result.setDebug(true);
        expect(options.isProviderRequestTraceEnabled?.()).toBe(true);
        options.onProviderRequestTrace?.(event);
        expect(result.log).toHaveBeenCalledWith('PA Agent trace', expect.objectContaining({ phase: 'http_dispatch', requestId: 'dynamic-hook' }));
        result.log.mockClear(); result.setDebug(false);
        expect(options.isProviderRequestTraceEnabled?.()).toBe(false);
        options.onProviderRequestTrace?.(event);
        expect(result.log).not.toHaveBeenCalled();
    });

    it('keeps a non-enumerable Personal source receipt across style projection and runtime cleanup', async () => {
        const result = await runScenario('personal-source');
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> => event.kind === 'writing-artifact');
        expect(result.inputs[1]).toContain('Authorized personal background');
        expect(result.inputs.join('')).not.toContain('isSourceCurrent');
        expect(result.inputs.join('')).not.toContain('revision-1');
        expect(artifact?.generationInput).toMatchObject({
            personal: { state: 'identified', mode: 'governed',
                revisions: [{ claimId: 'claim-1', revisionId: 'revision-1' }] },
            insights: { state: 'none' },
        });
        expect(artifact?.isSourceCurrent?.()).toBe(true);
        result.revokePersonal();
        expect(artifact?.isSourceCurrent?.()).toBe(false);
    });

    it('rejects a physical retry after Personal authority changes even with identical background text', async () => {
        const result = await runScenario('personal-retry');
        expect(result.retryErrors).toHaveLength(1);
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
    });

    it('records Pagelet backing hashes without claiming its rendered body is reload-verifiable', async () => {
        const result = await runScenario('pagelet');
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> => event.kind === 'writing-artifact');
        expect(result.inputs[1]).toContain('Source-backed handoff');
        expect(artifact?.generationInput?.pagelet).toEqual({
            state: 'unknown', id: result.pagelet.id, pipelineVersion: result.pagelet.pipelineVersion,
            anchor: { path: result.pagelet.anchor.path, mtime: 10, size: 20,
                contentHash: { algorithm: 'unspecified', value: 'a'.repeat(64) } },
            sources: [{ path: result.pagelet.sources[0].path, mtime: 30, size: 40,
                contentHash: { algorithm: 'unspecified', value: 'b'.repeat(64) } }],
        });
    });
    it('delivers a source receipt that survives runtime cleanup but rejects a later style revocation', async () => {
        const result = await runScenario('complete');
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> => event.kind === 'writing-artifact');
        expect(artifact?.isSourceCurrent?.()).toBe(true);
        expect(JSON.stringify(artifact)).not.toContain('isSourceCurrent');
        result.revokeStyle();
        expect(artifact?.isSourceCurrent?.()).toBe(false);
    });
    it('saves an admitted scoped parent after stream cleanup and rejects later source revocation', async () => {
        const result = await runScenario('complete', false, undefined, 'notes');
        expect(result.error).toBeUndefined();
        expect(result.inputs[0]).not.toContain('Authorized parent draft');
        expect(result.inputs[1]).toContain('Authorized parent draft');
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> =>
            event.kind === 'writing-artifact');
        if (!artifact?.isSourceCurrent || !artifact.generationInput) throw new Error('Missing scoped Writing artifact');
        expect(artifact.isSourceCurrent()).toBe(true);
        const saved = new Map<string, WritingVersion>([[result.parent.id, result.parent]]);
        const versions = new WritingVersionService({
            getWritingVersion: async id => saved.get(id) ?? null,
            listWritingVersions: async () => [...saved.values()],
            putWritingVersion: async (version, assertSourceCurrent) => {
                assertSourceCurrent?.(); saved.set(version.id, cloneWritingVersion(version));
            },
        });
        const child = await versions.create({ requestId: artifact.requestId, messageId: artifact.messageId,
            conversationId: 'conversation', turnIndex: 2, text: artifact.body, images: [],
            parentVersionId: result.parent.id, generationInput: artifact.generationInput }, artifact.isSourceCurrent);
        expect(saved.get(child.id)?.parentVersionId).toBe(result.parent.id);
        result.revokeParentSource();
        expect(artifact.isSourceCurrent()).toBe(false);
    });
    it('tracks selected image and style with a scoped parent tool observation', async () => {
        const result = await runScenario('image-subset', false, undefined, 'notes');
        expect(result.error).toBeUndefined();
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> =>
            event.kind === 'writing-artifact');
        if (!artifact?.generationInput || !artifact.isSourceCurrent) throw new Error('Missing scoped Writing artifact');
        expect(artifact.associatedImages).toEqual([result.images[1]]);
        expect(generationInputSnapshotInputLineage(artifact.generationInput)).toMatchObject({
            completeness: 'complete', dependencies: expect.arrayContaining([
                { kind: 'attachment', ownerMessageId: 'writing-parent-user', ref: result.images[1].ref },
                { kind: 'writing-style', revisionIds: ['style-1'] },
                { kind: 'writing-version', versionId: result.parent.id, textHash: result.parent.textHash },
            ]),
        });
        expect(artifact.isSourceCurrent()).toBe(true);
        result.revokeImage();
        expect(artifact.isSourceCurrent()).toBe(false);
    });
    it('rejects a scoped parent artifact when its selected style is revoked after streaming', async () => {
        const result = await runScenario('complete', false, undefined, 'notes');
        expect(result.error).toBeUndefined();
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> =>
            event.kind === 'writing-artifact');
        expect(artifact?.isSourceCurrent?.()).toBe(true);
        result.revokeStyle();
        expect(artifact?.isSourceCurrent?.()).toBe(false);
    });
    it('rejects a scoped parent save when its Data Boundary permission is revoked after streaming', async () => {
        const result = await runScenario('complete', false, undefined, 'notes');
        expect(result.error).toBeUndefined();
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> =>
            event.kind === 'writing-artifact');
        if (!artifact?.isSourceCurrent || !artifact.generationInput) throw new Error('Missing scoped Writing artifact');
        expect(artifact.isSourceCurrent()).toBe(true);
        result.revokeParentPermission();
        expect(artifact.isSourceCurrent()).toBe(false);
        const versions = new WritingVersionService({
            getWritingVersion: async id => id === result.parent.id ? result.parent : null,
            listWritingVersions: async () => [result.parent],
            putWritingVersion: jest.fn(),
        });
        await expect(versions.create({ requestId: artifact.requestId, messageId: artifact.messageId,
            conversationId: 'conversation', turnIndex: 2, text: artifact.body, images: [],
            parentVersionId: result.parent.id, generationInput: artifact.generationInput }, artifact.isSourceCurrent))
            .rejects.toThrow('Writing conversation changed');
    });
    it('invalidates a scoped parent receipt when its run selection changes after streaming', async () => {
        const result = await runScenario('complete', false, undefined, 'notes');
        expect(result.error).toBeUndefined();
        const artifact = result.events.find((event): event is Extract<LegacyAgentEvent, { kind: 'writing-artifact' }> =>
            event.kind === 'writing-artifact');
        expect(artifact?.isSourceCurrent?.()).toBe(true);
        result.revokeScope();
        expect(artifact?.isSourceCurrent?.()).toBe(false);
    });
    it('does not offer a Vault-backed Writing parent in a web scoped run', async () => {
        const result = await runScenario('complete', false, undefined, 'web');
        expect(result.inputs.length).toBeGreaterThanOrEqual(1);
        expect(result.inputs.join('')).not.toContain('Authorized parent draft');
        expect(result.inputs.join('')).not.toContain('earlier-message');
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
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
    it('bounds repeated preparation of the same current writing selection', async () => {
        const result = await runScenario('repeat-selection');
        expect(result.error).toBeUndefined();
        expect(result.prepareStyle).toHaveBeenCalledTimes(1);
        expect(result.inputs.length).toBeLessThanOrEqual(4);
        expect(result.lifecycle.find(event => event.type === 'agent_end')).toMatchObject({
            status: 'incomplete', metadata: { reason: 'equivalent_no_progress' },
        });
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
    });
    it('allows one correction of a rejected scene object before presenting the work', async () => {
        const result = await runScenario('schema-repair');
        expect(result.error).toBeUndefined();
        expect(result.inputs).toHaveLength(3);
        expect(result.inputs[0]).toContain('Follow the current user request when choosing notes');
        expect(result.inputs[1]).toContain('Follow the current user request when choosing notes');
        expect(result.inputs[2]).toContain('Follow the current user request when choosing notes');
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
                writingContext: { parentVersionId: expect.any(String), scene }, generationInput: {
                    schemaVersion: 2, inputPurpose: 'writing', task: { state: 'none', sources: [] },
                    personal: { state: 'none' }, insights: { state: 'none' },
                    style: { state: 'identified', revisionIds: ['style-1'] }, images: [],
                    parent: { state: 'identified', versionId: result.parent.id,
                        textHash: { algorithm: 'sha256', value: result.parent.textHash } },
                    pagelet: { state: 'none' },
                    lineage: { state: 'unknown' },
                } }),
        ]);
        expect(result.events.some(event => event.kind === 'writing-recovery')).toBe(false);
    });

    it('does not revive a legacy parent when native context explicitly selects a new topic', async () => {
        const result = await runScenario('new-topic');
        expect(result.error).toBeUndefined();
        expect(result.inputs[1]).not.toContain('<selected_writing_version');
        expect(result.events.find(event => event.kind === 'writing-artifact')).toMatchObject({
            writingContext: { scene }, generationInput: { parent: { state: 'none' } },
        });
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
            generationInput: { images: scenario === 'image-subset'
                ? [{ ref: result.images[1].ref, hashAlgorithm: 'sha256' }]
                : [] },
        });
    });

    it('keeps the incomplete output source receipt after cleanup and rejects later revocation', async () => {
        const result = await runScenario('incomplete');
        expect(result.events.some(event => event.kind === 'writing-artifact')).toBe(false);
        const recovery = result.events.find(event => event.kind === 'writing-recovery');
        expect(recovery?.rawText).toContain('请来参加周五的分享');
        expect(recovery?.isSourceCurrent?.()).toBe(true);
        expect(recovery?.generationInput).toMatchObject({
            style: { state: 'identified', revisionIds: ['style-1'] },
            parent: { state: 'identified', versionId: result.parent.id },
        });
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
        expect(result.lifecycle.at(-1)).toMatchObject({ type: 'agent_end', status: 'completed' });
    });

    it('lets explicit Writing report an unfinished task without creating a work or recovery artifact', async () => {
        const result = await runScenario('reported-incomplete');
        expect(result.error).toBeUndefined();
        expect(result.inputs).toHaveLength(1);
        expect(result.schemas[0].map(schema => schema.function.name)).toContain('report_task_incomplete');
        expect(result.lifecycle.at(-1)).toMatchObject({ type: 'agent_end', status: 'incomplete',
            metadata: expect.objectContaining({ reason: 'agent_reported_incomplete' }) });
        expect(result.events).toContainEqual(expect.objectContaining({
            kind: 'answer-snapshot', snapshot: 'I cannot complete this writing task.',
        }));
        expect(result.events.some(event => event.kind === 'writing-artifact' || event.kind === 'writing-recovery')).toBe(false);
        expect(result.prepareStyle).not.toHaveBeenCalled();
    });

    it('reports withheld ordinary Chat as incomplete when its generation sources change during streaming', async () => {
        const result = await runScenario('ordinary-revoked');
        expect(result.error).toBeUndefined();
        expect(result.inputs).toHaveLength(1);
        expect(result.lifecycle.find(event => event.type === 'turn_end')).toMatchObject({ status: 'incomplete' });
        expect(result.lifecycle.at(-1)).toMatchObject({ type: 'agent_end', status: 'incomplete' });
        expect(result.events.filter(event => event.kind === 'writing-preview').map(event => event.text))
            .toEqual(['We can discuss the options first.', '']);
        expect(result.events.some(event => event.kind === 'writing-recovery')).toBe(false);
        expect(result.events.some(event => event.kind === 'answer-snapshot' || event.kind === 'writing-artifact')).toBe(false);
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
