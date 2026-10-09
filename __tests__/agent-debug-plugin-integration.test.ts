import { AgentDebugPluginIntegration } from '../src/agent-debug/plugin-integration';
import { AgentDebugService } from '../src/agent-debug/service';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { DEFAULT_SETTINGS } from '../src/settings';

jest.mock('../src/agent-debug/service');

function setup(history = new MemoryChatHistoryStore()) {
    const service = {
        initialize: jest.fn(async () => undefined),
        applySourceToken: jest.fn(async () => undefined),
        invalidateConversation: jest.fn(async (): Promise<void> => undefined),
        forgetClaim: jest.fn(async () => undefined),
        forgetLegacyRecord: jest.fn(async () => undefined),
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
    const readForgetState = jest.fn(async () => ({ claims: [], legacyRecordIds: [] }));
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
