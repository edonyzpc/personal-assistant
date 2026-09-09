import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { AIMessageChunk } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';

import { AIUtils } from '../src/ai-services/ai-utils';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import type { AgentEvent, ChatWritingStyleResult, LegacyAgentEvent } from '../src/ai-services/chat-types';
import { PaAgentRuntime } from '../src/ai-services/pa-agent-runtime';
import { WritingStyleService } from '../src/chat/writing-style-service';
import type { WritingVersion } from '../src/chat/writing-types';
import { MemoryGovernanceCoordinator } from '../src/pa/memory-governance-coordinator';
import { InMemoryMemoryGovernanceRepository } from '../src/pa/memory-governance-persistence';
import { hashWritingStyleText } from '../src/pa/writing-style';
import type { ImageAssetService } from '../src/chat/image-assets';
import type { MessageImage } from '../src/chat/image-types';

jest.mock('obsidian');
afterEach(() => { jest.restoreAllMocks(); });

const scene = { writingTask: 'copywriting', purpose: 'social_share', audience: 'friends', domain: 'travel' };
const styleText = '我在旅途中，收集了一些温柔的光。';
const body = '  海边的风，替我收好了今天的疲惫。\n🌊\n';
const rawText = JSON.stringify({ kind: 'pa.writing', version: 1, requestId: 'writing-1', body, explanation: '参考已授权表达习惯' });

interface FixtureScenario {
    enterReserve?: () => void;
    extraCall?: string;
    imageMode?: 'valid' | 'revoke';
}

async function fixture(outcome: 'complete' | 'cancel' | 'tail-error' | 'forget', debug = false, native = false, toolBinding = true, scenario: FixtureScenario = {}) {
    const { enterReserve, extraCall, imageMode } = scenario;
    let imageCurrent = true;
    const images: MessageImage[] = [1, 2].map((ordinal) => ({
        ref: { assetId: `selected-${ordinal}`, contentHash: String(ordinal).repeat(64) }, ordinal, label: `Photo ${ordinal}`,
    }));
    const oldImage: MessageImage = { ref: { assetId: 'old-unselected', contentHash: '3'.repeat(64) }, ordinal: 1, label: 'Old photo' };
    const releaseImage = jest.fn();
    const imageService = {
        resolveVariant: jest.fn(async (ref: MessageImage['ref']) => ({
            blob: new Blob([new Uint8Array([ref.assetId === 'selected-1' ? 1 : 2])]),
            mime: 'image/jpeg', width: 1, height: 1, persistent: true, release: releaseImage,
        })),
        verify: jest.fn(async () => ({ asset: {}, isCurrent: () => imageCurrent })),
    };
    const providerText = native ? JSON.stringify({ body, explanation: '参考已授权表达习惯', contextHandle: 'writing-1' }) : rawText;
    const repository = new InMemoryMemoryGovernanceRepository();
    await repository.transact((state) => {
        state.policyStates.vault = { version: 1, mode: 'effect_based', contextProjectionMode: 'governed' };
    });
    let snapshot = await repository.initialize();
    let nextId = 0;
    const coordinator = new MemoryGovernanceCoordinator({ repository, opaqueVaultKey: 'vault', idFactory: () => `style-${++nextId}` });
    const version: WritingVersion = {
        id: 'version-1', requestId: 'sample-request', messageId: 'sample-message', conversationId: 'conversation-1',
        text: styleText, textHash: hashWritingStyleText(styleText), explanation: '', origin: 'ai_generated',
        turnIndex: 0, createdAt: 1, associatedImages: [], backgroundSourceRefs: [], styleRevisionIds: [], scene,
    };
    const styleService = new WritingStyleService({
        versions: { get: async () => version }, coordinator,
        getStateSnapshot: () => ({ state: snapshot, vaultScopeKey: 'vault' }),
        isRuntimeEnabled: () => true,
        verifyNoteSource: async () => { throw new Error('This independently authorized sample has no note source'); },
    });
    const remembered = await styleService.remember(version.id, scene, 'explicit-remember-action');
    snapshot = await repository.initialize();

    // Same minimal Obsidian host used by the production B-129 runtime fixture.
    // Only the provider is scripted; prompt projection, loop and bridge are real.
    const host = {
        settings: {
            debug,
            aiProvider: 'openai', baseURL: 'https://writing-preview.invalid/v1', chatModelName: 'fixture-model',
            embeddingModelName: 'fixture-embedding', policyModelName: '', skillContextEnabled: false, enabledSkillIds: [],
            webSearchEnabled: false, memoryEnabled: false, licenseTier: 'free', statisticsVaultId: 'fixture-vault',
            retrievalOptimizationFlags: { lexicalProfile: false, strictReranker: false, graphPpr: false, relaxedRecovery: false },
        },
        app: {
            workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null, cachedRead: async () => '' },
            metadataCache: { getFileCache: () => null },
        },
        memorySearch: { ensureReadyForChat: async () => ({ decision: 'answer-now' }), searchHybrid: async () => [], getChunksByPath: async () => [] },
        getAPIToken: async () => 'synthetic-fixture-token', log: jest.fn(), isOperationsAgentEnabled: false,
        getMemoryExtractionPromptContext: () => undefined,
    };
    const controller = new AbortController();
    const events: LegacyAgentEvent[] = [];
    const lifecycle: AgentEvent[] = [];
    const prepared: ChatWritingStyleResult[] = [];
    const preparedSignals: Array<AbortSignal | undefined> = [];
    const providerInputs: unknown[] = [];
    const boundSchemas: unknown[] = [];
    const schemaBatches: unknown[][] = [];
    let bodyReceived: () => void = () => undefined;
    const bodyConsumed = new Promise<void>((resolve) => { bodyReceived = resolve; });
    const aiUtils = new AIUtils(host);
    const createModel = jest.spyOn(aiUtils, 'createChatModel').mockImplementation(async (_temperature, options) => {
        enterReserve?.();
        const model = RunnableLambda.from(async function* (input: unknown) {
            options?.onProviderRequestStart?.();
            providerInputs.push(input);
            yield new AIMessageChunk(native ? {
                content: '', tool_call_chunks: [{ id: 'native-call', index: 0, name: 'present_writing', args: providerText }],
            } : { content: providerText });
            // Wait until the runtime has consumed the body before changing the
            // user's generation state or the underlying governance revision.
            await bodyConsumed;
            if (imageMode === 'revoke') imageCurrent = false;
            if (extraCall) yield new AIMessageChunk({ content: '', tool_call_chunks: [
                { id: 'forbidden-extra', index: 1, name: extraCall, args: '{}' },
            ] });
            if (outcome === 'cancel') {
                controller.abort();
                const error = new Error('User cancelled generation');
                error.name = 'AbortError';
                throw error;
            }
            if (outcome === 'forget') {
                await coordinator.forget({ claimId: remembered.claimId });
                snapshot = await repository.initialize();
            }
            yield new AIMessageChunk({ content: '', response_metadata: { finish_reason: native ? 'tool_calls' : 'stop' } });
            if (outcome === 'tail-error') throw new Error('Usage transport tail failed');
        });
        if (native && toolBinding) Object.assign(model, { bindTools: (schemas: unknown[]) => {
            boundSchemas.push(...schemas); schemaBatches.push(schemas); return model;
        } });
        return model as unknown as Awaited<ReturnType<AIUtils['createChatModel']>>;
    });
    const runtime = new PaAgentRuntime(host as unknown as AiServiceHost, aiUtils, {
        skillContextProvider: null,
        ...(enterReserve ? { maxWallClockMs: 1000, finalizationReserveMs: 300 } : {}),
    });
    const run = async () => {
        try {
            await runtime.streamTurn({
                prompt: '帮我写一段旅行朋友圈文案', memoryMode: 'auto', writingRequest: { requestId: 'writing-1' },
                ...(native ? { writingOutputProtocol: 'native' as const } : {}),
                ...(imageMode ? {
                    images, imageAssetService: imageService as unknown as ImageAssetService,
                    imageCapability: { get: () => 'supported' as const, onSuccess: jest.fn(), onError: jest.fn() },
                    chatHistory: [{ role: 'user' as const, content: 'Earlier photo', images: [oldImage] }],
                } : {}),
                signal: controller.signal,
                prepareWritingStyle: async (budget) => {
                    const result = await styleService.prepare(scene, budget);
                    prepared.push(result);
                    preparedSignals.push(budget.signal);
                    return result;
                },
                onEvent: (event) => events.push(event),
                onLifecycleEvent: (event) => {
                    lifecycle.push(event);
                    if (event.type === 'message_update' && (
                        (event.update.kind === 'text_delta' && event.update.text === rawText)
                        || (native && event.metadata?.nativeWritingArguments === providerText)
                    )) bodyReceived();
                },
            });
        } finally { runtime.dispose(); }
    };
    return { run, events, lifecycle, prepared, preparedSignals, providerInputs, boundSchemas, schemaBatches, createModel, controller, remembered, images, imageService, releaseImage, log: host.log as jest.Mock };
}

function expectGovernedStyleWasSent(f: Awaited<ReturnType<typeof fixture>>): void {
    expect(f.createModel).toHaveBeenCalledTimes(1);
    expect(f.providerInputs).toHaveLength(1);
    expect(JSON.stringify(f.providerInputs[0])).toContain(styleText);
    expect(f.prepared).toHaveLength(1);
    expect(f.prepared[0].context).toContain(styleText);
    expect(f.prepared[0].revisionIds).toEqual([f.remembered.revisionId]);
}

describe('writing preview with a governed style through the production runtime', () => {
    it.each(['valid', 'revoke'] as const)('native images keep ordered pixels and host source admission when %s', async (imageMode) => {
        const f = await fixture('complete', false, true, true, { imageMode });
        await f.run();
        expectGovernedStyleWasSent(f);
        expect(f.imageService.resolveVariant.mock.calls.map(([ref]) => ref)).toEqual(f.images.map((image) => image.ref));
        const sent = JSON.stringify(f.providerInputs[0]);
        expect(sent).toContain('data:image/jpeg;base64,AQ==');
        expect(sent).toContain('data:image/jpeg;base64,Ag==');
        expect(sent.indexOf('data:image/jpeg;base64,AQ==')).toBeLessThan(sent.indexOf('data:image/jpeg;base64,Ag=='));
        expect(f.releaseImage).toHaveBeenCalledTimes(2);
        const artifacts = f.events.filter((event) => event.kind === 'writing-artifact');
        if (imageMode === 'valid') {
            expect(artifacts).toEqual([expect.objectContaining({ body, associatedImages: f.images, styleRevisionIds: [f.remembered.revisionId] })]);
        } else {
            expect(artifacts).toHaveLength(0);
            expect(f.events.find((event) => event.kind === 'writing-recovery')).toMatchObject({ rawText: '', previewText: '', reason: 'source_changed' });
        }
    });
    it.each(['search_memory', 'get_current_note_context', 'vault_create', 'present_writing'])(
        'rejects a reserved-final output mixed with %s before any tool execution', async (extraCall) => {
            let now = 0;
            jest.spyOn(Date, 'now').mockImplementation(() => now);
            const f = await fixture('tail-error', false, true, true, { enterReserve: () => { now = 750; }, extraCall });
            await f.run();
            expect(f.providerInputs).toHaveLength(1);
            expect(f.schemaBatches.at(-1)).toHaveLength(1);
            expect(f.events.some((event) => event.kind === 'writing-artifact')).toBe(false);
            expect(f.lifecycle.some((event) => event.type === 'tool_execution_start')).toBe(false);
            expect(f.lifecycle.find((event) => event.type === 'agent_end')).toMatchObject({ status: 'incomplete' });
        },
    );
    it('binds only the pure output and delivers once when model setup reaches the reserved final phase', async () => {
        let now = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const f = await fixture('tail-error', false, true, true, { enterReserve: () => { now = 750; } });
        await f.run();
        expect(f.providerInputs).toHaveLength(1);
        expect(f.schemaBatches.at(-1)).toEqual([expect.objectContaining({ function: expect.objectContaining({ name: 'present_writing' }) })]);
        expect(JSON.stringify(f.providerInputs[0])).toContain('Only present_writing (pure output) is available');
        expect(f.lifecycle.filter((event) => event.type === 'turn_start')).toContainEqual(expect.objectContaining({
            metadata: expect.objectContaining({ toolMode: 'final_answer_only', controlSnapshot: expect.objectContaining({ writingOutput: 'present_writing', sourceScope: 'none' }) }),
        }));
        expect(f.events.filter((event) => event.kind === 'writing-artifact')).toEqual([
            expect.objectContaining({ body, styleRevisionIds: [f.remembered.revisionId] }),
        ]);
        expect(f.lifecycle.some((event) => event.type === 'tool_execution_start')).toBe(false);
    });
    it('rejects an unbindable native model before provider stream or invoke can run', async () => {
        const f = await fixture('tail-error', false, true, false);
        await expect(f.run()).rejects.toThrow('Native writing requires model tool binding.');
        expect(f.createModel).toHaveBeenCalledTimes(1);
        expect(f.providerInputs).toHaveLength(0);
        expect(f.boundSchemas).toHaveLength(0);
        expect(f.prepared).toHaveLength(0);
        expect(f.events.some((event) => event.kind === 'writing-artifact')).toBe(false);
    });
    it.each(['tail-error', 'cancel', 'forget'] as const)('native runtime preserves governed style and handles %s without an extra model request', async (outcome) => {
        const f = await fixture(outcome, false, true);
        if (outcome === 'cancel') await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' });
        else await f.run();
        expectGovernedStyleWasSent(f);
        expect(f.boundSchemas).toContainEqual(expect.objectContaining({ function: expect.objectContaining({
            name: 'present_writing', parameters: expect.objectContaining({ additionalProperties: false }),
        }) }));
        const input = JSON.stringify(f.providerInputs[0]);
        expect(input).toContain('present_writing');
        expect(input).not.toContain('Required shape:');
        expect(f.lifecycle.some((event) => event.type === 'tool_execution_start')).toBe(false);
        const artifacts = f.events.filter((event) => event.kind === 'writing-artifact');
        if (outcome === 'tail-error') {
            expect(artifacts).toEqual([expect.objectContaining({ body, styleRevisionIds: [f.remembered.revisionId] })]);
        } else {
            expect(artifacts).toHaveLength(0);
            expect(f.events.find((event) => event.kind === 'writing-recovery')).toMatchObject({
                previewText: outcome === 'cancel' ? body : '',
                ...(outcome === 'forget' ? { rawText: '', reason: 'source_changed' } : {}),
            });
        }
    });
    it.each([false, true])('records only local whitelist delivery evidence when debug=%s', async (debug) => {
        const f = await fixture('tail-error', debug);
        await f.run();
        const deliveryLogs = f.log.mock.calls.filter((args) => args[0] === 'PA Agent writing delivery');
        expect(deliveryLogs).toHaveLength(debug ? 1 : 0);
        if (debug) {
            expect(deliveryLogs[0][1]).toMatchObject({
                providerCompletion: 'stop', transportOutcome: 'error', schemaState: 'valid', result: 'artifact',
            });
            const serialized = JSON.stringify(deliveryLogs);
            for (const secret of [body, styleText, 'synthetic-fixture-token', 'writing-preview.invalid']) {
                expect(serialized).not.toContain(secret);
            }
        }
    });
    it('keeps readable recovery after the user cancels a received body without creating an artifact', async () => {
        const f = await fixture('cancel');
        await expect(f.run()).rejects.toMatchObject({ name: 'AbortError' });

        expectGovernedStyleWasSent(f);
        expect(f.controller.signal.aborted).toBe(true);
        expect(f.prepared[0].isCurrent()).toBe(false);
        expect(f.prepared[0].isSourceCurrent?.()).toBe(true);
        expect(f.events.filter((event) => event.kind === 'writing-preview')).toEqual([
            expect.objectContaining({ requestId: 'writing-1', text: body }),
        ]);
        expect(f.events.find((event) => event.kind === 'writing-recovery')).toMatchObject({
            requestId: 'writing-1', reason: 'incomplete', rawText, previewText: body,
        });
        expect(f.events.some((event) => event.kind === 'writing-artifact' || event.kind === 'answer-snapshot')).toBe(false);
        expect(f.lifecycle.find((event) => event.type === 'agent_end')).toMatchObject({ status: 'aborted' });
    });

    it('creates the completed artifact after a stop and tail error despite loop-owned signal cleanup', async () => {
        const f = await fixture('tail-error');
        await f.run();

        expectGovernedStyleWasSent(f);
        expect(f.controller.signal.aborted).toBe(false);
        expect(f.preparedSignals[0]?.aborted).toBe(true);
        expect(f.prepared[0].isCurrent()).toBe(false);
        expect(f.prepared[0].isSourceCurrent?.()).toBe(true);
        expect(f.events.find((event) => event.kind === 'writing-artifact')).toMatchObject({
            requestId: 'writing-1', body, styleRevisionIds: [f.remembered.revisionId],
        });
        expect(f.events.some((event) => event.kind === 'writing-recovery')).toBe(false);
        expect(f.events.filter((event) => event.kind === 'answer-snapshot')).toEqual([
            expect.objectContaining({ snapshot: body }),
        ]);
        expect(f.lifecycle.find((event) => event.type === 'agent_end')).toMatchObject({ status: 'completed' });
    });

    it('clears an already displayed preview and refuses an artifact when its style is forgotten concurrently', async () => {
        const f = await fixture('forget');
        await f.run();

        expectGovernedStyleWasSent(f);
        expect(f.controller.signal.aborted).toBe(false);
        expect(f.prepared[0].isSourceCurrent?.()).toBe(false);
        expect(f.events.filter((event) => event.kind === 'writing-preview')).toEqual([
            expect.objectContaining({ text: body }), expect.objectContaining({ text: '' }),
        ]);
        expect(f.events.find((event) => event.kind === 'writing-recovery')).toMatchObject({
            requestId: 'writing-1', reason: 'source_changed', rawText, previewText: '',
        });
        expect(f.events.some((event) => event.kind === 'writing-artifact' || event.kind === 'answer-snapshot')).toBe(false);
    });
});
