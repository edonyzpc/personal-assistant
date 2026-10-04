import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { ImageGenerationService } from '../src/chat/image-generation-service';
import type { ImageAssetService } from '../src/chat/image-assets';
import type { ImageGenerationTask } from '../src/chat/image-generation-types';
import { isImageStatusObservation, type ImageStatusReadScope } from '../src/chat/image-generation-status';
import type { ImageGenerationConnection } from '../src/ai-services/image-generation-connection';
import type { WanImageProvider, WanImageTask } from '../src/ai-services/wan-image-provider';

const connection: ImageGenerationConnection = { mode: 'dedicated-wan',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', synchronousEndpoint: 'unused',
    asynchronousEndpoint: 'unused', tasksEndpoint: 'unused', credentialSlot: 'image-token', revision: 1 };
const now = '2026-10-04T00:00:00.000Z';

async function fixture(state: 'prepared' | 'running' | 'submission_unknown' = 'running') {
    const store = new MemoryChatHistoryStore();
    await store.upsertConversation({ id: 'conversation_one', title: 'Synthetic image', createdAt: now,
        updatedAt: now, turnCount: 0, preview: '' });
    const prepared: ImageGenerationTask = { schemaVersion: 1, taskId: 'task_one', operationId: 'operation_one',
        conversationId: 'conversation_one', stableMessageId: 'original_message', createdAt: now,
        updatedAt: now, revision: 0, state: 'prepared', outputs: [],
        request: { userPrompt: 'PRIVATE_USER_PROMPT', submittedPrompt: 'PRIVATE_PROVIDER_PROMPT',
            operation: 'generate', model: 'wan2.7-image', count: 1, inputRefs: [] },
        connection: { mode: connection.mode, endpointIdentity: connection.baseURL,
            credentialSlot: connection.credentialSlot, revision: connection.revision } };
    await store.putImageGenerationTask(prepared);
    const task: ImageGenerationTask = state === 'prepared' ? prepared
        : { ...(await store.claimImageGenerationSubmission(prepared.taskId, 0, now))!, revision: 2, state,
            ...(state === 'running' ? { providerTaskId: 'wan_one', lastProviderState: 'RUNNING' } : {}) };
    if (task !== prepared) await store.putImageGenerationTask(task, 1);
    const provider = { submit: jest.fn<WanImageProvider['submit']>(),
        query: jest.fn<WanImageProvider['query']>(async () => ({ taskId: 'wan_one', status: 'RUNNING', imageUrls: [] })),
        cancel: jest.fn<WanImageProvider['cancel']>() };
    const download = jest.fn<(url: string) => Promise<ArrayBuffer>>();
    const getToken = jest.fn(async () => 'synthetic-token');
    let currentConnection: ImageGenerationConnection | null = connection;
    const service = new ImageGenerationService({ store, assets: {} as ImageAssetService, getToken,
        providerFactory: () => provider as unknown as WanImageProvider,
        resolveConnection: () => currentConnection, now: () => Date.parse(now), download });
    const scope: ImageStatusReadScope = { conversationId: 'conversation_one', isCurrent: () => true,
        canReadTask: identity => identity.stableMessageId === 'original_message', canQueryProvider: () => true };
    return { store, task, provider, download, getToken, service, scope,
        setConnection: (value: ImageGenerationConnection | null) => { currentConnection = value; } };
}

afterEach(() => { jest.useRealTimers(); });

describe('existing image status reads', () => {
    it('resolves both identities to a fresh finite local snapshot without contacting the provider', async () => {
        const f = await fixture();
        f.scope.canQueryProvider = () => false;
        const first = await f.service.readStatus({ taskId: f.task.taskId }, f.scope);
        await f.store.putImageGenerationTask({ ...f.task, revision: 3, lastProviderState: 'PENDING' }, 2);
        const second = await f.service.readStatus({ operationId: f.task.operationId }, f.scope);
        expect(first).toMatchObject({ status: 'available', revision: 2, basis: 'local_snapshot',
            taskId: 'task_one', operationId: 'operation_one', providerState: 'RUNNING',
            remoteQueryAvailable: false });
        expect(first).not.toHaveProperty('blockingReason');
        expect(second).toMatchObject({ status: 'available', revision: 3, providerState: 'PENDING',
            remoteQueryAvailable: false, remoteQueryReason: 'network_not_allowed' });
        expect(isImageStatusObservation(second)).toBe(true);
        expect(JSON.stringify(second)).not.toMatch(/PRIVATE_|credential|endpoint|synthetic-token|original_message/);
        expect(f.getToken).not.toHaveBeenCalled();
        expect(f.provider.query).not.toHaveBeenCalled();
    });

    it('keeps submission unknown without a remote ID and does not infer acceptance from a missing record', async () => {
        const f = await fixture('submission_unknown');
        expect(await f.service.readStatus({ operationId: f.task.operationId, refresh: true }, f.scope)).toMatchObject({
            status: 'available', localState: 'submission_unknown', basis: 'local_snapshot',
            remoteQueryAvailable: false, remoteQueryReason: 'no_provider_task', nextAction: 'needs_user' });
        expect(await f.service.readStatus({ taskId: 'missing' }, f.scope)).toEqual({
            status: 'unavailable', reason: 'task_unavailable' });
        expect(f.getToken).not.toHaveBeenCalled();
        expect(f.provider.query).not.toHaveBeenCalled();
        expect(f.provider.submit).not.toHaveBeenCalled();
    });

    it.each([
        { state: 'prepared', recoveryReason: 'transparent_input_needs_confirmation' },
        { state: 'running', recoveryReason: 'credential_unavailable' },
    ] as const)('reports an owner-stopped waiting task as needing the user: %s/%s',
        async ({ state, recoveryReason }) => {
            const f = await fixture(state);
            const task = { ...f.task, revision: f.task.revision + 1, recoveryReason };
            await f.store.putImageGenerationTask(task, f.task.revision);
            const result = await f.service.readStatus({ taskId: task.taskId }, f.scope);
            expect(result).toMatchObject({ status: 'available', localState: state,
                blockingReason: recoveryReason, nextAction: 'needs_user' });
            expect(result).not.toHaveProperty('retryAfterMs');
            expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|synthetic-token|original_message/);
            expect(await f.store.getImageGenerationTask(task.taskId)).toEqual(task);
            expect(f.getToken).not.toHaveBeenCalled();
            expect(f.provider.query).not.toHaveBeenCalled();
            expect(f.provider.submit).not.toHaveBeenCalled();
        });

    it('does not promote or leak an unknown persisted recovery reason while the owner may still retry', async () => {
        const f = await fixture();
        const task = { ...f.task, revision: f.task.revision + 1,
            recoveryReason: 'PRIVATE_UNEXPECTED_RAW_ERROR' };
        await f.store.putImageGenerationTask(task, f.task.revision);
        const result = await f.service.readStatus({ taskId: task.taskId }, f.scope);
        expect(result).toMatchObject({ localState: 'running', nextAction: 'wait', retryAfterMs: 3000 });
        expect(result).not.toHaveProperty('blockingReason');
        expect(JSON.stringify(result)).not.toContain('PRIVATE_UNEXPECTED_RAW_ERROR');
        expect(isImageStatusObservation(result)).toBe(true);
    });

    it('requires the bound conversation and visible origin, and rejects expired runs and cancellation', async () => {
        const f = await fixture();
        const request = { taskId: f.task.taskId, refresh: true };
        const unavailable = { status: 'unavailable', reason: 'task_unavailable' };
        expect(await f.service.readStatus(request, { ...f.scope, conversationId: 'another_conversation' })).toEqual(unavailable);
        expect(await f.service.readStatus(request, { ...f.scope, canReadTask: () => false })).toEqual(unavailable);
        await expect(f.service.readStatus(request, { ...f.scope, isCurrent: () => false })).rejects.toThrow('image_status:request_changed');
        const controller = new AbortController(); controller.abort();
        await expect(f.service.readStatus(request, { ...f.scope, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        await f.store.putImageGenerationTask({ ...f.task, revision: 3, deliverySuppressed: true }, 2);
        expect(await f.service.readStatus(request, f.scope)).toEqual(unavailable);
        expect(f.getToken).not.toHaveBeenCalled();
        expect(f.provider.query).not.toHaveBeenCalled();
    });

    it('refreshes once without changing the task, importing output, submitting, cancelling or starting polling', async () => {
        jest.useFakeTimers();
        const f = await fixture();
        f.provider.query.mockResolvedValue({ taskId: 'wan_one', status: 'SUCCEEDED',
            imageUrls: ['https://example.invalid/PRIVATE_SIGNED_OUTPUT'] });
        const result = await f.service.readStatus({ operationId: f.task.operationId, refresh: true }, f.scope);
        expect(result).toMatchObject({ status: 'available', localState: 'running', providerState: 'SUCCEEDED',
            basis: 'provider_query', checkedAt: now, nextAction: 'wait', retryAfterMs: 3000 });
        expect(f.provider.query).toHaveBeenCalledTimes(1);
        expect(f.provider.query).toHaveBeenCalledWith('wan_one');
        expect(await f.store.getImageGenerationTask(f.task.taskId)).toEqual(f.task);
        expect(JSON.stringify(result)).not.toContain('PRIVATE_SIGNED_OUTPUT');
        expect(f.provider.submit).not.toHaveBeenCalled();
        expect(f.provider.cancel).not.toHaveBeenCalled();
        expect(f.download).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('does not dispatch after connection changes during credential loading', async () => {
        const f = await fixture();
        f.getToken.mockImplementation(async () => {
            f.setConnection({ ...connection, revision: 2 });
            return 'synthetic-token';
        });
        expect(await f.service.readStatus({ taskId: f.task.taskId, refresh: true }, f.scope)).toMatchObject({
            status: 'available', basis: 'local_snapshot', remoteQueryReason: 'connection_changed', nextAction: 'needs_user' });
        expect(f.provider.query).not.toHaveBeenCalled();
    });

    it.each(['connection', 'network', 'origin', 'run', 'abort'] as const)(
        'discards a provider response when %s admission changes during the read', async change => {
            const f = await fixture();
            const controller = new AbortController(); f.scope.signal = controller.signal;
            f.provider.query.mockImplementation(async (): Promise<WanImageTask> => {
                if (change === 'connection') f.setConnection({ ...connection, baseURL: 'https://different.invalid/v1' });
                if (change === 'network') f.scope.canQueryProvider = () => false;
                if (change === 'origin') f.scope.canReadTask = () => false;
                if (change === 'run') f.scope.isCurrent = () => false;
                if (change === 'abort') controller.abort();
                return { taskId: 'wan_one', status: 'SUCCEEDED', imageUrls: [] };
            });
            const read = f.service.readStatus({ taskId: f.task.taskId, refresh: true }, f.scope);
            if (change === 'run') await expect(read).rejects.toThrow('image_status:request_changed');
            else if (change === 'abort') await expect(read).rejects.toMatchObject({ name: 'AbortError' });
            else {
                const result = await read;
                if (change === 'origin') expect(result).toEqual({ status: 'unavailable', reason: 'task_unavailable' });
                else expect(result).toMatchObject({ basis: 'local_snapshot', providerState: 'RUNNING',
                    remoteQueryReason: change === 'connection' ? 'connection_changed' : 'network_not_allowed' });
                expect(result).not.toHaveProperty('checkedAt');
            }
            expect(await f.store.getImageGenerationTask(f.task.taskId)).toEqual(f.task);
            expect(f.provider.submit).not.toHaveBeenCalled();
        },
    );

    it('returns a bounded local observation after a transport failure without exposing the exception', async () => {
        const f = await fixture();
        f.provider.query.mockRejectedValue(new Error('PRIVATE_PROVIDER_URL_OR_ERROR'));
        const result = await f.service.readStatus({ taskId: f.task.taskId, refresh: true }, f.scope);
        expect(result).toMatchObject({ basis: 'local_snapshot', localState: 'running',
            remoteQueryReason: 'provider_unavailable', nextAction: 'wait', retryAfterMs: 3000 });
        expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    });
});
