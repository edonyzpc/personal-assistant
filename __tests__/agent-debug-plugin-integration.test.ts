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
        recordSourceRevocation,
    });
    return { integration, service, history, settings, recordSourceRevocation, readForgetState };
}

describe('B-145 plugin governance adapters', () => {
    afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });

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

    it('retries a failed file revocation commit before reopening details', async () => {
        jest.useFakeTimers();
        const { integration, service, recordSourceRevocation } = setup();
        await integration.initialize();
        service.setRecoveryReady.mockClear();
        recordSourceRevocation.mockRejectedValueOnce(new Error('settings unavailable'));
        integration.sourceRevoked();
        integration.sourceRevoked();
        await jest.advanceTimersByTimeAsync(0);
        expect(recordSourceRevocation).toHaveBeenCalledTimes(1);
        expect(service.setRecoveryReady).not.toHaveBeenCalledWith(true);
        await jest.advanceTimersByTimeAsync(30_000);
        expect(recordSourceRevocation).toHaveBeenCalledTimes(2);
        expect(service.applySourceToken).toHaveBeenLastCalledWith('source:new');
        expect(service.setRecoveryReady).toHaveBeenLastCalledWith(true);
        await integration.dispose();
    });

    it('cannot reopen details from stale recovery while a newer permission or Forget write is pending', async () => {
        const { integration, service, settings, readForgetState } = setup();
        let release!: () => void;
        readForgetState.mockImplementationOnce(() => new Promise(resolve => {
            release = () => resolve({ claims: [], legacyRecordIds: [] });
        }));
        const startup = integration.initialize();
        for (let i = 0; i < 12; i++) await Promise.resolve();
        integration.sourcePermissionRevoking();
        const finishForget = integration.beginLegacyForget();
        release();
        await startup;
        expect(service.setRecoveryReady).not.toHaveBeenCalledWith(true);
        settings.dataBoundary.sourceRevocationEpoch = 'source:committed';
        integration.sourcePermissionCommitted();
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

    it('recovers an uncertain settings write only after a fresh revocation epoch commits', async () => {
        jest.useFakeTimers();
        const { integration, service, recordSourceRevocation } = setup();
        await integration.initialize();
        service.setRecoveryReady.mockClear();
        integration.sourcePermissionRevoking();
        recordSourceRevocation.mockRejectedValueOnce(new Error('still unavailable'));
        integration.sourcePermissionFailed();
        await jest.advanceTimersByTimeAsync(0);
        expect(service.setRecoveryReady).not.toHaveBeenCalledWith(true);
        await jest.advanceTimersByTimeAsync(30_000);
        expect(recordSourceRevocation).toHaveBeenCalledTimes(2);
        expect(service.applySourceToken).toHaveBeenLastCalledWith('source:new');
        expect(service.setRecoveryReady).toHaveBeenLastCalledWith(true);
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
