import { AgentDebugPluginIntegration, type AgentDebugPluginOptions } from '../src/agent-debug/plugin-integration';
import { AgentDebugService } from '../src/agent-debug/service';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { completeInputLineage } from '../src/ai-services/input-lineage';
import type { PaAgentActionState } from '../src/ai-services/pa-agent-result-facts';
import { DEFAULT_SETTINGS } from '../src/settings';

jest.mock('../src/agent-debug/service');

function setup(history = new MemoryChatHistoryStore()) {
    const service = {
        initialize: jest.fn(async () => undefined),
        applySourceToken: jest.fn(async () => undefined),
        invalidateConversation: jest.fn(async (): Promise<void> => undefined),
        forgetClaim: jest.fn(async () => undefined),
        forgetLegacyRecord: jest.fn(async () => undefined),
        getPersistedEvents: jest.fn(async (captureId: string) => captureId === 'capture-related'
            ? [{ captureId, seq: 1, nodeId: 'node-related', availability: 'cleared' as const },
                { captureId, seq: 2, nodeId: 'node-unrelated', availability: 'cleared' as const }]
            : [{ captureId, seq: 1, nodeId: 'node-other', availability: 'capacity' as const }]),
        getEvents: jest.fn(async (captureId: string) => [
            { captureId, seq: 1, nodeId: 'node-other', availability: 'cleared' as const },
        ]),
        setRecoveryReady: jest.fn(), setEnabled: jest.fn(), blockConversation: jest.fn(), unblockConversation: jest.fn(),
        dispose: jest.fn(async () => undefined),
        getTracePage: jest.fn(async () => ({ events: [], liveEvents: [], through: 0, nextAfter: 0,
            hasMore: false, run: null, availability: 'cleared' as const })),
    };
    jest.mocked(AgentDebugService).mockImplementation(() => service as unknown as AgentDebugService);
    const settings = structuredClone(DEFAULT_SETTINGS);
    const recordSourceRevocation = jest.fn(async () => {
        settings.dataBoundary.sourceRevocationEpoch = 'source:new';
    });
    const readForgetState = jest.fn(async (): ReturnType<AgentDebugPluginOptions['readForgetState']> =>
        ({ claims: [], legacyRecordIds: [] }));
    const integration = new AgentDebugPluginIntegration({
        vault: { adapter: { getBasePath: () => '/test-vault' } } as never,
        settings: () => settings,
        history: () => history,
        readForgetState,
    });
    return { integration, service, history, settings, recordSourceRevocation, readForgetState };
}

describe('B-145 plugin governance adapters', () => {
    afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

    it('drains durable Chat deletion intent before returning a trace page', async () => {
        const { integration, service, history } = setup();
        await integration.initialize();
        let release!: () => void;
        service.invalidateConversation.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
        await history.deleteConversation('conversation');
        const reading = integration.viewHost().getTracePage('capture', { after: 10, through: 90 });
        for (let index = 0; index < 12; index++) await Promise.resolve();
        expect(service.invalidateConversation).toHaveBeenCalledWith('conversation', expect.any(Object));
        expect(service.getTracePage).not.toHaveBeenCalled();
        expect((await history.listDebugDeletions()).length).toBeGreaterThan(0);
        release();
        await reading;
        expect(service.invalidateConversation).toHaveBeenLastCalledWith('conversation', expect.objectContaining({ permanent: true }));
        expect(await history.listDebugDeletions()).toEqual([]);
        expect(service.getTracePage).toHaveBeenCalledWith('capture', { after: 10, through: 90 });
        await integration.dispose();
    });

    it('acknowledges Chat deletion only after Debug cleanup commits', async () => {
        const { integration, service, history } = setup();
        await history.deleteConversation('conversation');
        let release!: () => void;
        service.invalidateConversation.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
        const startup = integration.initialize();
        for (let i = 0; i < 8; i++) await Promise.resolve();
        expect(service.invalidateConversation).toHaveBeenCalledWith('conversation', expect.any(Object));
        expect((await history.listDebugDeletions()).length).toBeGreaterThan(0);
        release();
        await startup;
        expect(service.invalidateConversation).toHaveBeenCalledWith('conversation', expect.objectContaining({ permanent: true }));
        expect(await history.listDebugDeletions()).toEqual([]);
        expect(service.setRecoveryReady).toHaveBeenLastCalledWith(true);
        await integration.dispose();
    });

    it('invalidates saved captures without treating pending Chat IDs as runtime runs', async () => {
        const history = new MemoryChatHistoryStore();
        await history.initialize();
        await history.appendTurn({
            conversationId: 'conversation',
            turnIndex: 0,
            user: { role: 'user', content: 'question' },
            assistant: {
                role: 'assistant',
                content: 'answer',
                agentExecution: { runId: 'chat-pending-id', state: 'completed' },
            },
            executionSummary: {
                version: 1,
                runtimeRunId: 'runtime-real',
                elapsedMs: 10,
                steps: [],
                debug: { captureId: 'capture-real', nodes: [] },
            },
        });
        const { integration, service } = setup(history);
        await history.deleteTurn('conversation', 0);
        await integration.initialize();
        expect(service.invalidateConversation).toHaveBeenCalledWith('conversation', expect.objectContaining({
            runIds: ['runtime-real'],
            captureIds: ['capture-real'],
        }));
        await integration.dispose();
    });

    it('retries durable Forget evidence and revises unknown scope without using globally cleared live events', async () => {
        const actionState: PaAgentActionState = {
            schemaVersion: 1,
            owner: 'image',
            operationId: 'operation-kept',
            phase: 'accepted',
            revision: 0,
            origin: { runId: 'runtime-related', turnId: 'turn-related', assistantId: 'assistant-1',
                callId: 'call-1', resultId: 'result-1' },
            receipt: { kind: 'image-accepted', taskId: 'operation-kept' },
            inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user-1' }]),
        };
        class RetryHistory extends MemoryChatHistoryStore {
            revisions = 0;
            override async reviseDebugReferencesForForget(
                claimId: string | undefined,
                findClearedReferences: Parameters<MemoryChatHistoryStore['reviseDebugReferencesForForget']>[1],
            ): ReturnType<MemoryChatHistoryStore['reviseDebugReferencesForForget']> {
                this.revisions++;
                return super.reviseDebugReferencesForForget!(claimId, findClearedReferences);
            }
        }
        const history = new RetryHistory();
        await history.initialize();
        await history.appendTurn({
            conversationId: 'conversation',
            turnIndex: 0,
            user: { role: 'user', content: 'question' },
            assistant: {
                role: 'assistant',
                content: 'answer kept',
                actionStateBinding: { conversationId: 'conversation', turnIndex: 0,
                    runId: 'runtime-related', turnId: 'turn-related' },
                actionStates: [actionState],
                inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user-1' }]),
            },
            executionSummary: {
                version: 1,
                runtimeRunId: 'runtime-related',
                elapsedMs: 12,
                steps: [
                    { key: 'step-related', order: 0, kind: 'tool', status: 'succeeded',
                        runId: 'runtime-related', turnId: 'turn-related', toolCallId: 'call-related' },
                    { key: 'step-kept', order: 1, kind: 'model', status: 'succeeded',
                        runId: 'runtime-related', turnId: 'turn-related' },
                ],
                debug: { captureId: 'capture-related', nodes: [
                    { captureId: 'capture-related', nodeId: 'node-related', turnId: 'turn-related', kind: 'reasoning' },
                    { captureId: 'capture-related', nodeId: 'node-unrelated', turnId: 'turn-related', kind: 'tool' },
                ] },
            },
        });
        await history.appendTurn({
            conversationId: 'conversation',
            turnIndex: 1,
            user: { role: 'user', content: 'other question' },
            assistant: { role: 'assistant', content: 'other answer kept' },
            executionSummary: {
                version: 1,
                runtimeRunId: 'runtime-other',
                steps: [],
                debug: { captureId: 'capture-other', nodes: [
                    { captureId: 'capture-other', nodeId: 'node-other', kind: 'reasoning' },
                ] },
            },
        });
        const { integration, service, readForgetState } = setup(history);
        await integration.initialize();
        readForgetState.mockResolvedValue({ claims: [{ id: 'claim-related', deviceWide: false }], legacyRecordIds: [] });
        service.getPersistedEvents.mockRejectedValueOnce(new Error('Debug event read failed'));
        await expect(integration.forgetClaim('claim-related', false)).rejects.toThrow('Debug event read failed');
        const finishRecovery = integration.beginLegacyForget();
        finishRecovery();
        for (let index = 0; index < 20; index++) await Promise.resolve();
        expect(history.revisions).toBeGreaterThanOrEqual(2);
        expect(service.forgetClaim).toHaveBeenCalledTimes(2);
        expect(service.getPersistedEvents).toHaveBeenCalledWith('capture-other', { after: 0, limit: 200 });
        expect(service.getEvents).not.toHaveBeenCalled();
        const turns = await history.getTurns('conversation');
        expect(turns[0].executionSummary?.debug).toEqual({ captureId: 'capture-related', nodes: [] });
        expect(turns[0].executionSummary?.steps.map(step => step.key)).toEqual(['step-related', 'step-kept']);
        expect(turns[0].assistant.content).toBe('answer kept');
        expect(turns[0].assistant.actionStates).toEqual([actionState]);
        expect(turns[1].executionSummary?.debug?.nodes).toHaveLength(1);
        expect(turns[1].assistant.content).toBe('other answer kept');
        await integration.dispose();
    });

    it('retains failed deletion intent and hides content without undoing the Chat deletion', async () => {
        jest.useFakeTimers();
        const { integration, service, history } = setup();
        await history.deleteConversation('conversation');
        service.invalidateConversation.mockRejectedValueOnce(new Error('quota'));
        await integration.initialize();
        expect(await history.getConversation('conversation')).toBeNull();
        expect((await history.listDebugDeletions()).length).toBeGreaterThan(0);
        expect(service.setRecoveryReady).toHaveBeenLastCalledWith(false);
        await jest.advanceTimersByTimeAsync(30_000);
        expect(await history.listDebugDeletions()).toEqual([]);
        await integration.dispose();
    });

    it('does not recheck or clear actual history when source permissions change', async () => {
        const { integration, service, settings, readForgetState } = setup();
        await integration.initialize();
        service.setRecoveryReady.mockClear();
        readForgetState.mockClear();
        settings.dataBoundary.sourceRevocationEpoch = 'new-exclusion';
        integration.settingsChanged();
        expect(service.setRecoveryReady).not.toHaveBeenCalled();
        expect(service.applySourceToken).not.toHaveBeenCalled();
        expect(readForgetState).not.toHaveBeenCalled();
        await integration.dispose();
    });

    it('cannot reopen details from stale recovery while an explicit Forget write is pending', async () => {
        const { integration, service, settings, readForgetState } = setup();
        let release!: () => void;
        readForgetState.mockImplementationOnce(() => new Promise(resolve => {
            release = () => resolve({ claims: [], legacyRecordIds: [] });
        }));
        const startup = integration.initialize();
        for (let i = 0; i < 12; i++) await Promise.resolve();
        const finishForget = integration.beginLegacyForget();
        release();
        await startup;
        expect(service.setRecoveryReady).not.toHaveBeenCalledWith(true);
        settings.dataBoundary.sourceRevocationEpoch = 'source:committed';
        integration.settingsChanged();
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(service.setRecoveryReady).not.toHaveBeenCalledWith(true);
        finishForget();
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(service.setRecoveryReady).toHaveBeenLastCalledWith(true);
        await integration.dispose();
    });

    it('releases a temporary conversation gate when the primary Chat deletion fails', async () => {
        class FailingHistory extends MemoryChatHistoryStore {
            async deleteConversation(id: string): Promise<void> {
                await this.observeDeletion(id, async () => { throw new Error('Chat write failed'); });
            }
        }
        const { integration, service, history } = setup(new FailingHistory());
        await integration.initialize();
        await expect(history.deleteConversation('kept')).rejects.toThrow('Chat write failed');
        for (let i = 0; i < 12; i++) await Promise.resolve();
        expect(service.blockConversation).toHaveBeenCalledWith('kept');
        expect(service.unblockConversation).toHaveBeenCalledWith('kept');
        expect(service.invalidateConversation).not.toHaveBeenCalled();
        await integration.dispose();
    });

    it('cannot re-enable capture from a late settings notification during unload', async () => {
        const { integration, service, settings } = setup();
        await integration.initialize();
        integration.beginUnload();
        settings.debug = true;
        integration.settingsChanged();
        expect(service.setEnabled).toHaveBeenLastCalledWith(false);
        await integration.dispose();
    });
});
