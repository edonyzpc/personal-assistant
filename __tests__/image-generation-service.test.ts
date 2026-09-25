import { describe, expect, it, jest } from '@jest/globals';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { ImageGenerationService } from '../src/chat/image-generation-service';
import { WanImageProvider, WanImageProviderError } from '../src/ai-services/wan-image-provider';
import type { ImageAssetService } from '../src/chat/image-assets';
import type { ImageGenerationTask } from '../src/chat/image-generation-types';
import { imageSourceHash } from '../src/chat/image-policy';
import * as imageInput from '../src/chat/image-generation-input';

const baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const connection = { mode: 'dedicated-wan' as const, baseURL,
    synchronousEndpoint: 'unused', asynchronousEndpoint: 'unused', tasksEndpoint: 'unused',
    credentialSlot: 'image-token', revision: 1 };

async function readyStore(): Promise<MemoryChatHistoryStore> {
    const store = new MemoryChatHistoryStore();
    await store.upsertConversation({ id: 'conversation_one', title: 'A red bird',
        createdAt: '2026-09-18T12:00:00.000Z', updatedAt: '2026-09-18T12:00:00.000Z',
        turnCount: 0, preview: '' });
    return store;
}

function makeService(store: MemoryChatHistoryStore, provider: Pick<WanImageProvider, 'submit' | 'query' | 'cancel'>,
    extra: { assets?: ImageAssetService; download?: (url: string) => Promise<ArrayBuffer> } = {}) {
    return new ImageGenerationService({ store, assets: extra.assets ?? {} as ImageAssetService,
        resolveConnection: () => connection, getToken: async () => 'secret',
        providerFactory: () => provider as WanImageProvider, download: extra.download });
}

async function settle(assertion: () => Promise<boolean>): Promise<void> {
    for (let i = 0; i < 30; i++) {
        if (await assertion()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Image task did not settle');
}

const input = { conversationId: 'conversation_one', stableMessageId: 'message_one', operationId: 'operation_one',
    userPrompt: 'Generate a red bird', submittedPrompt: 'A red bird', operation: 'generate' as const,
    count: 1, inputRefs: [] };
const png = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Dq0AAAAASUVORK5CYII=',
    'base64')).buffer;

describe('image generation service admission and recovery', () => {
    it('does not send a queued scoped prompt to Wan after its source receipt is revoked', async () => {
        const store = await readyStore();
        let releaseToken!: () => void;
        const tokenGate = new Promise<void>(resolve => { releaseToken = resolve; });
        let sourceCurrent = true;
        const physicalRequest = jest.fn(async () => ({ status: 200, json: {
            output: { task_id: 'wan_scoped', task_status: 'PENDING' },
        } }));
        const service = new ImageGenerationService({ store, assets: {} as ImageAssetService,
            resolveConnection: () => connection, getToken: async () => { await tokenGate; return 'synthetic-token'; },
            providerFactory: () => new WanImageProvider({ baseURL, apiKey: 'synthetic-token', request: physicalRequest }),
        });
        try {
            const { taskId } = await service.submit({ ...input, submittedPrompt: 'DERIVED_NOTE_PROMPT_SENTINEL',
                isSourceCurrent: () => sourceCurrent });
            expect((await service.get(taskId))?.requiresSourceReceipt).toBe(true);
            sourceCurrent = false;
            releaseToken();
            await settle(async () => (await service.get(taskId))?.recoveryReason === 'source_changed_before_submit'
                || physicalRequest.mock.calls.length > 0);
            expect(physicalRequest).not.toHaveBeenCalled();
            expect((await service.get(taskId))?.state).toBe('not_submitted');
            const restarted = makeService(store, { submit: jest.fn(async () => {
                throw new Error('unexpected Wan submit');
            }), query: jest.fn(async () => ({ taskId: 'unused', status: 'PENDING' as const, imageUrls: [] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) });
            try {
                await restarted.recover();
                await expect(restarted.resume(taskId)).rejects.toThrow('image_generation:source_changed');
                expect((await restarted.get(taskId))?.state).toBe('not_submitted');
            } finally { restarted.dispose(); }
        } finally { service.dispose(); }
    });

    it('still sends an explicit current-user image prompt through the Wan request body', async () => {
        const store = await readyStore();
        const physicalRequest = jest.fn(async (_request?: { method?: string; body?: unknown }) => ({ status: 200, json: {
            output: { task_id: 'wan_explicit', task_status: 'PENDING' },
        } }));
        const service = new ImageGenerationService({ store, assets: {} as ImageAssetService,
            resolveConnection: () => connection, getToken: async () => 'synthetic-token',
            providerFactory: () => new WanImageProvider({ baseURL, apiKey: 'synthetic-token', request: physicalRequest }),
        });
        try {
            const { taskId } = await service.submit({ ...input, submittedPrompt: 'EXPLICIT_USER_PROMPT_SENTINEL' });
            await settle(async () => physicalRequest.mock.calls.some(([request]) => request?.method === 'POST'));
            expect((await service.get(taskId))?.requiresSourceReceipt).toBeUndefined();
            expect(String(physicalRequest.mock.calls.find(([request]) => request?.method === 'POST')?.[0]?.body))
                .toContain('EXPLICIT_USER_PROMPT_SENTINEL');
        } finally { service.dispose(); }
    });

    it('does not deliver a scoped image after its source is revoked while Wan query is pending', async () => {
        const store = await readyStore();
        let sourceCurrent = true;
        let finishQuery!: (value: { taskId: string; status: 'SUCCEEDED'; imageUrls: string[] }) => void;
        const queryResult = new Promise<{ taskId: string; status: 'SUCCEEDED'; imageUrls: string[] }>(
            resolve => { finishQuery = resolve; });
        const provider = {
            submit: jest.fn(async () => ({ taskId: 'wan_pending', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(() => queryResult),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })),
        };
        const importFile = jest.fn(async () => ({ ref: { assetId: 'unexpected', contentHash: 'a'.repeat(64) } }));
        const service = makeService(store, provider, { assets: { importFile } as unknown as ImageAssetService,
            download: async () => png });
        try {
            const { taskId } = await service.submit({ ...input, isSourceCurrent: () => sourceCurrent });
            await settle(async () => provider.query.mock.calls.length > 0);
            sourceCurrent = false;
            finishQuery({ taskId: 'wan_pending', status: 'SUCCEEDED',
                imageUrls: ['https://oss-cn-beijing.aliyuncs.com/result.png'] });
            await settle(async () => (await service.get(taskId))?.state === 'stopped'
                || importFile.mock.calls.length > 0);
            expect(importFile).not.toHaveBeenCalled();
            expect((await service.get(taskId))?.state).toBe('stopped');
        } finally { service.dispose(); }
    });

    it('does not persist a scoped generated version after source revocation during version lookup', async () => {
        const store = await readyStore();
        let sourceCurrent = true;
        const ref = { assetId: 'scoped_output', contentHash: await imageSourceHash(png) };
        const putVersion = jest.spyOn(store, 'putGeneratedImageVersion');
        jest.spyOn(store, 'getGeneratedImageVersion').mockImplementation(async () => {
            sourceCurrent = false;
            return null;
        });
        const provider = {
            submit: jest.fn(async () => ({ taskId: 'wan_version', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_version', status: 'SUCCEEDED' as const,
                imageUrls: ['https://example.oss-cn-beijing.aliyuncs.com/result.png'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })),
        };
        const service = makeService(store, provider, { assets: {
            importFile: jest.fn(async () => ({ ref })),
        } as unknown as ImageAssetService, download: async () => png });
        try {
            const { taskId } = await service.submit({ ...input, isSourceCurrent: () => sourceCurrent });
            await settle(async () => (await service.get(taskId))?.state === 'stopped'
                || putVersion.mock.calls.length > 0);
            expect(putVersion).not.toHaveBeenCalled();
            expect((await service.get(taskId))?.state).toBe('stopped');
        } finally { service.dispose(); }
    });

    it('checks scoped source authority inside the generated-version store write', async () => {
        const store = await readyStore();
        let sourceCurrent = true;
        const originalPut = store.putGeneratedImageVersion.bind(store);
        const putVersion = jest.spyOn(store, 'putGeneratedImageVersion')
            .mockImplementation((version, assertSourceCurrent) => {
                sourceCurrent = false;
                return originalPut(version, assertSourceCurrent);
            });
        const ref = { assetId: 'scoped_store_output', contentHash: await imageSourceHash(png) };
        const provider = {
            submit: jest.fn(async () => ({ taskId: 'wan_store', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_store', status: 'SUCCEEDED' as const,
                imageUrls: ['https://example.oss-cn-beijing.aliyuncs.com/result.png'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })),
        };
        const service = makeService(store, provider, { assets: {
            importFile: jest.fn(async () => ({ ref })),
        } as unknown as ImageAssetService, download: async () => png });
        try {
            const { taskId } = await service.submit({ ...input, isSourceCurrent: () => sourceCurrent });
            await settle(async () => (await service.get(taskId))?.state === 'stopped'
                || (await store.listGeneratedImageVersions(taskId)).length > 0);
            expect(putVersion).toHaveBeenCalledTimes(1);
            expect(await store.listGeneratedImageVersions(taskId)).toEqual([]);
            expect((await service.get(taskId))?.state).toBe('stopped');
        } finally { service.dispose(); }
    });

    it('commits the submission claim before the one physical POST', async () => {
        const store = await readyStore();
        let stateAtPost: ImageGenerationTask['state'] | undefined;
        const provider = { submit: jest.fn(async () => {
            stateAtPost = (await store.getImageGenerationTaskByOperationId(input.operationId))?.state;
            return { taskId: 'wan_one', status: 'PENDING' as const, imageUrls: [] };
        }), query: jest.fn(async () => ({ taskId: 'wan_one', status: 'PENDING' as const, imageUrls: [] })),
        cancel: jest.fn(async () => ({ cancellationAccepted: true })) };
        const service = makeService(store, provider);
        const accepted = await service.submit(input);
        expect(accepted.taskId).toBeTruthy();
        await settle(async () => (await service.get(accepted.taskId))?.state === 'running');
        expect(stateAtPost).toBe('submitting');
        expect(provider.submit).toHaveBeenCalledTimes(1);
        await service.submit(input);
        expect(provider.submit).toHaveBeenCalledTimes(1);
        service.dispose();
    });

    it('does not restore a deleted chat from a late provider result', async () => {
        const store = await readyStore();
        let finishQuery!: (value: { taskId: string; status: 'SUCCEEDED'; imageUrls: string[] }) => void;
        const queryResult = new Promise<{ taskId: string; status: 'SUCCEEDED'; imageUrls: string[] }>(
            (resolve) => { finishQuery = resolve; });
        const provider = { submit: jest.fn(async () => ({ taskId: 'wan_late', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(() => queryResult), cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const importFile = jest.fn(async () => ({ ref: { assetId: 'unexpected', contentHash: 'a'.repeat(64) } }));
        const service = makeService(store, provider, { assets: { importFile } as unknown as ImageAssetService });
        try {
            const { taskId } = await service.submit(input);
            await settle(async () => provider.query.mock.calls.length > 0);
            await store.deleteConversation('conversation_one');
            finishQuery({ taskId: 'wan_late', status: 'SUCCEEDED', imageUrls: ['https://example.com/result.png'] });
            await settle(async () => (await service.get(taskId)) === null);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(importFile).not.toHaveBeenCalled();
            expect(await store.listImageGenerationTasks()).toHaveLength(0);
            expect(await store.listGeneratedImageVersions(taskId)).toHaveLength(0);
        } finally { service.dispose(); }
    });

    it('keeps acceptance unknown without replaying a paid request', async () => {
        const store = await readyStore();
        const provider = { submit: jest.fn(async () => { throw new WanImageProviderError('submission_unknown'); }),
            query: jest.fn(async () => ({ taskId: 'unused', status: 'PENDING' as const, imageUrls: [] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const service = makeService(store, provider);
        const { taskId } = await service.submit(input);
        await settle(async () => (await service.get(taskId))?.state === 'submission_unknown');
        await service.submit(input);
        await service.recover();
        expect(provider.submit).toHaveBeenCalledTimes(1);
        expect((await service.get(taskId))?.providerTaskId).toBeUndefined();
        service.dispose();
    });

    it('resumes polling a persisted provider task without another submission', async () => {
        const store = await readyStore(), now = new Date().toISOString();
        await store.putImageGenerationTask({ schemaVersion: 1, taskId: 'task_running_recovery',
            operationId: 'operation_running_recovery', conversationId: input.conversationId,
            stableMessageId: input.stableMessageId, createdAt: now, updatedAt: now, revision: 0,
            request: { userPrompt: input.userPrompt, submittedPrompt: input.submittedPrompt,
                operation: 'generate', model: 'wan2.7-image', count: 1, inputRefs: [] },
            connection: { mode: connection.mode, endpointIdentity: connection.baseURL,
                credentialSlot: connection.credentialSlot, revision: connection.revision },
            state: 'prepared', outputs: [] });
        const claimed = await store.claimImageGenerationSubmission('task_running_recovery', 0, now);
        await store.putImageGenerationTask({ ...claimed!, state: 'running', revision: 2,
            providerTaskId: 'wan_existing' }, 1);
        const provider = { submit: jest.fn(async () => { throw new Error('unexpected submit'); }),
            query: jest.fn(async (_taskId?: string) => ({ taskId: 'wan_existing',
                status: 'PENDING' as const, imageUrls: [] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const service = makeService(store, provider);
        try {
            await service.recover();
            await settle(async () => provider.query.mock.calls.length > 0);
            expect(provider.query).toHaveBeenCalledWith('wan_existing');
            expect(provider.submit).not.toHaveBeenCalled();
            expect((await service.get('task_running_recovery'))?.state).toBe('running');
        } finally { service.dispose(); }
    });

    it('accepts two separately stated single images as an explicit total of two', async () => {
        const store = await readyStore();
        const provider = { submit: jest.fn(async (_request?: unknown) => ({ taskId: 'wan_two_images', status: 'PENDING' as const,
            imageUrls: [] })), query: jest.fn(async () => ({ taskId: 'wan_two_images', status: 'PENDING' as const,
            imageUrls: [] })), cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const service = makeService(store, provider);
        const { taskId } = await service.submit({ ...input, userPrompt: '一张猫，一张狗', count: 2 });
        await settle(async () => (await service.get(taskId))?.state === 'running');
        expect(provider.submit).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }));
        service.dispose();
    });

    it('shows a definitely unsent startup task as resumable, then submits once', async () => {
        const store = await readyStore();
        const now = new Date().toISOString();
        await store.putImageGenerationTask({ schemaVersion: 1, taskId: 'task_unsent',
            operationId: 'operation_unsent', conversationId: input.conversationId,
            stableMessageId: input.stableMessageId, createdAt: now, updatedAt: now, revision: 0,
            request: { userPrompt: input.userPrompt, submittedPrompt: input.submittedPrompt,
                operation: 'generate', model: 'wan2.7-image', count: 1, inputRefs: [] },
            connection: { mode: connection.mode, endpointIdentity: connection.baseURL,
                credentialSlot: connection.credentialSlot, revision: connection.revision },
            state: 'prepared', outputs: [] });
        const provider = { submit: jest.fn(async () => ({ taskId: 'wan_two', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_two', status: 'PENDING' as const, imageUrls: [] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const service = makeService(store, provider);
        await service.recover();
        expect((await service.get('task_unsent'))?.state).toBe('not_submitted');
        expect(provider.submit).not.toHaveBeenCalled();
        await service.resume('task_unsent');
        await settle(async () => (await service.get('task_unsent'))?.state === 'running');
        expect(provider.submit).toHaveBeenCalledTimes(1);
        service.dispose();
    });

    it('saves the original result and a matching generated version before completion', async () => {
        const store = await readyStore();
        const bytes = Uint8Array.from(Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Dq0AAAAASUVORK5CYII=',
            'base64')).buffer;
        const ref = { assetId: 'generated_one', contentHash: await imageSourceHash(bytes) };
        const importFile = jest.fn(async () => ({ ref }));
        const provider = { submit: jest.fn(async () => ({ taskId: 'wan_three', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_three', status: 'SUCCEEDED' as const,
                imageUrls: ['https://example.oss-cn-beijing.aliyuncs.com/result.png'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const service = makeService(store, provider, {
            assets: { importFile, readOriginal: async () => ({ bytes }) } as unknown as ImageAssetService,
            download: async () => bytes,
        });
        const { taskId } = await service.submit(input);
        await settle(async () => (await service.get(taskId))?.state === 'completed');
        expect(importFile).toHaveBeenCalledTimes(1);
        const task = await service.get(taskId);
        expect(task?.outputs[0].assetRef).toEqual(ref);
        const version = await service.getVersionForOutput(taskId, 'output_0');
        expect(version?.assetRef).toEqual(ref);
        expect(version?.submittedPrompt).toBe(input.submittedPrompt);
        expect((await service.readOutput(taskId, 'output_0')).bytes).toBe(bytes);
        service.dispose();
    });

    it('edits the exact saved version and records its parent without changing the earlier result', async () => {
        const store = await readyStore();
        const ref = { assetId: 'generated_one', contentHash: await imageSourceHash(png) };
        const prepare = jest.spyOn(imageInput, 'prepareWanImageInput').mockImplementation(async (_bytes, _isCurrent, allow) => {
            if (!allow) throw new Error('image_generation:transparent_input_needs_confirmation');
            return { dataUrl: 'data:image/png;base64,AAAA', whiteBackgroundApplied: true };
        });
        const importFile = jest.fn(async () => ({ ref }));
        const verify = jest.fn(async (_ref?: unknown, _purpose?: unknown) => ({ asset: {}, isCurrent: () => true }));
        const readOriginal = jest.fn(async (_ref?: unknown, _purpose?: unknown) => ({ bytes: png }));
        const provider = {
            submit: jest.fn(async (_request?: unknown) => ({ taskId: 'wan_edit', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_edit', status: 'SUCCEEDED' as const,
                imageUrls: ['https://example.oss-cn-beijing.aliyuncs.com/result.png'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })),
        };
        const service = makeService(store, provider, { assets: {
            verify, readOriginal, importFile,
        } as unknown as ImageAssetService, download: async () => png });
        try {
            const { taskId: firstTaskId } = await service.submit(input);
            await settle(async () => (await service.get(firstTaskId))?.state === 'completed');
            const first = await service.getVersionForOutput(firstTaskId, 'output_0');
            expect(first?.assetRef).toEqual(ref);

            const { taskId: editTaskId } = await service.submit({ ...input,
                operationId: 'operation_edit', stableMessageId: 'message_edit',
                operation: 'edit', inputRefs: [ref], parentVersionId: first!.versionId,
                userPrompt: 'Change the background', submittedPrompt: 'Change the background' });
            await settle(async () => (await service.get(editTaskId))?.recoveryReason === 'transparent_input_needs_confirmation');
            expect(provider.submit).toHaveBeenCalledTimes(1);
            await service.approveWhiteBackground(editTaskId);
            await settle(async () => (await service.get(editTaskId))?.state === 'completed');
            expect(verify).toHaveBeenCalledWith(ref, 'provider');
            expect(readOriginal).toHaveBeenCalledWith(ref, 'provider');
            expect(prepare).toHaveBeenLastCalledWith(png, expect.any(Function), true);
            expect(provider.submit).toHaveBeenLastCalledWith(expect.objectContaining({
                prompt: 'Change the background', referenceImages: ['data:image/png;base64,AAAA'] }));
            expect((await service.get(editTaskId))?.inputWhiteBackgroundApplied).toBe(true);
            expect((await service.getVersionForOutput(editTaskId, 'output_0'))?.parentVersionId).toBe(first!.versionId);
            expect(await service.getVersionForOutput(firstTaskId, 'output_0')).toEqual(first);

            const { taskId: declinedTaskId } = await service.submit({ ...input,
                operationId: 'operation_declined', stableMessageId: 'message_declined',
                operation: 'edit', inputRefs: [ref], parentVersionId: first!.versionId });
            await settle(async () => (await service.get(declinedTaskId))?.recoveryReason === 'transparent_input_needs_confirmation');
            await service.stop(declinedTaskId);
            expect((await service.get(declinedTaskId))?.state).toBe('stopped');
            expect((await service.get(declinedTaskId))?.recoveryReason).toBe('stopped_before_submit');
            expect(provider.submit).toHaveBeenCalledTimes(2);
        } finally {
            service.dispose(); prepare.mockRestore();
        }
    });

    it('imports a Wan result served from the official OSS acceleration bucket domain', async () => {
        const store = await readyStore();
        const ref = { assetId: 'accelerated_result', contentHash: await imageSourceHash(png) };
        const originalFetch = globalThis.fetch;
        const fetchResult = jest.fn(async (_url?: string, _init?: RequestInit) => ({ status: 200, redirected: false,
            url: 'https://dashscope-7c2c.oss-accelerate.aliyuncs.com/result.png',
            headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => png } as Response));
        globalThis.fetch = fetchResult as typeof fetch;
        const provider = { submit: jest.fn(async () => ({ taskId: 'wan_accelerate', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_accelerate', status: 'SUCCEEDED' as const,
                imageUrls: ['https://dashscope-7c2c.oss-accelerate.aliyuncs.com/result.png'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const service = makeService(store, provider, { assets: {
            importFile: async () => ({ ref }), readOriginal: async () => ({ bytes: png }),
        } as unknown as ImageAssetService });
        try {
            const { taskId } = await service.submit(input);
            await settle(async () => (await service.get(taskId))?.state === 'completed');
            expect((await service.get(taskId))?.outputs[0].assetRef).toEqual(ref);
            expect(fetchResult).toHaveBeenCalledWith(
                'https://dashscope-7c2c.oss-accelerate.aliyuncs.com/result.png',
                { method: 'GET', redirect: 'manual', credentials: 'omit' });
        } finally {
            service.dispose();
            globalThis.fetch = originalFetch;
        }
    });

    it('rejects a redirected result before importing an image', async () => {
        const store = await readyStore();
        const originalFetch = globalThis.fetch;
        const fetchResult = jest.fn(async (_url?: string, _init?: RequestInit) => ({ status: 0, redirected: false,
            url: 'https://dashscope-7c2c.oss-accelerate.aliyuncs.com/result.png',
            headers: new Headers(), arrayBuffer: async () => png } as Response));
        globalThis.fetch = fetchResult as typeof fetch;
        const importFile = jest.fn(async () => ({ ref: { assetId: 'unexpected', contentHash: await imageSourceHash(png) } }));
        const provider = { submit: jest.fn(async () => ({ taskId: 'wan_redirect', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_redirect', status: 'SUCCEEDED' as const,
                imageUrls: ['https://dashscope-7c2c.oss-accelerate.aliyuncs.com/result.png'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const service = makeService(store, provider, { assets: { importFile } as unknown as ImageAssetService });
        try {
            const { taskId } = await service.submit(input);
            await settle(async () => (await service.get(taskId))?.state === 'partial');
            expect(fetchResult).toHaveBeenCalledWith(expect.any(String),
                { method: 'GET', redirect: 'manual', credentials: 'omit' });
            expect(importFile).not.toHaveBeenCalled();
        } finally {
            service.dispose();
            globalThis.fetch = originalFetch;
        }
    });
    it('does not import a result when Stop wins during download', async () => {
        const store = await readyStore();
        let finishDownload: ((bytes: ArrayBuffer) => void) | undefined;
        const download = jest.fn(() => new Promise<ArrayBuffer>((resolve) => { finishDownload = resolve; }));
        const importFile = jest.fn(async () => ({ ref: { assetId: 'unexpected', contentHash: 'a'.repeat(64) } }));
        const provider = { submit: jest.fn(async () => ({ taskId: 'wan_stop', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_stop', status: 'SUCCEEDED' as const, imageUrls: ['unused'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const service = makeService(store, provider, { assets: { importFile } as unknown as ImageAssetService, download });
        const { taskId } = await service.submit(input);
        await settle(async () => Boolean(finishDownload));
        await service.stop(taskId);
        finishDownload!(png);
        await settle(async () => (await service.get(taskId))?.state === 'stopped');
        expect(importFile).not.toHaveBeenCalled();
        service.dispose();
    });

    it('keeps a result linked to its stopped task when Stop races with import', async () => {
        const store = await readyStore();
        const ref = { assetId: 'saved_after_stop', contentHash: await imageSourceHash(png) };
        let finishImport: (() => void) | undefined;
        const importFile = jest.fn(() => new Promise<{ ref: typeof ref }>((resolve) => {
            finishImport = () => resolve({ ref });
        }));
        const provider = { submit: jest.fn(async () => ({ taskId: 'wan_import', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_import', status: 'SUCCEEDED' as const, imageUrls: ['unused'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const service = makeService(store, provider, { assets: { importFile } as unknown as ImageAssetService,
            download: async () => png });
        const { taskId } = await service.submit(input);
        await settle(async () => Boolean(finishImport));
        await service.stop(taskId);
        finishImport!();
        await settle(async () => (await service.get(taskId))?.outputs[0]?.saveState === 'saved');
        expect((await service.get(taskId))?.state).toBe('stopped');
        expect((await service.get(taskId))?.outputs[0]?.assetRef).toEqual(ref);
        expect((await service.getVersionForOutput(taskId, 'output_0'))?.assetRef).toEqual(ref);
        service.dispose();
    });

    it('keeps an imported original as provenance but does not deliver it after scoped source revocation during import', async () => {
        const store = await readyStore();
        const ref = { assetId: 'scoped_imported_original', contentHash: await imageSourceHash(png) };
        let finishImport: (() => void) | undefined;
        let sourceCurrent = true;
        const importFile = jest.fn(() => new Promise<{ ref: typeof ref }>((resolve) => {
            finishImport = () => resolve({ ref });
        }));
        const provider = { submit: jest.fn(async () => ({ taskId: 'wan_scoped_import', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_scoped_import', status: 'SUCCEEDED' as const, imageUrls: ['unused'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const readOriginal = jest.fn(async () => ({ bytes: png }));
        const service = makeService(store, provider, { assets: { importFile, readOriginal } as unknown as ImageAssetService,
            download: async () => png });
        try {
            const { taskId } = await service.submit({ ...input, isSourceCurrent: () => sourceCurrent });
            await settle(async () => Boolean(finishImport));
            sourceCurrent = false;
            finishImport!();
            await settle(async () => (await service.get(taskId))?.state === 'stopped'
                && (await service.get(taskId))?.outputs[0]?.saveState === 'saved');
            expect((await service.get(taskId))?.outputs[0]?.assetRef).toEqual(ref);
            await expect(service.readOutput(taskId, 'output_0')).rejects.toThrow('image_generation:source_changed');
            expect(readOriginal).not.toHaveBeenCalled();
        } finally { service.dispose(); }
    });

    it('keeps a completed scoped output readable only while its live source receipt remains valid', async () => {
        const store = await readyStore();
        const ref = { assetId: 'scoped_completed_original', contentHash: await imageSourceHash(png) };
        let sourceCurrent = true;
        const provider = { submit: jest.fn(async () => ({ taskId: 'wan_scoped_completed', status: 'PENDING' as const, imageUrls: [] })),
            query: jest.fn(async () => ({ taskId: 'wan_scoped_completed', status: 'SUCCEEDED' as const, imageUrls: ['unused'] })),
            cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const readOriginal = jest.fn(async () => ({ bytes: png }));
        const service = makeService(store, provider, { assets: { importFile: jest.fn(async () => ({ ref })), readOriginal } as unknown as ImageAssetService,
            download: async () => png });
        try {
            const { taskId } = await service.submit({ ...input, isSourceCurrent: () => sourceCurrent });
            await settle(async () => (await service.get(taskId))?.state === 'completed');
            expect((await service.readOutput(taskId, 'output_0')).bytes).toBe(png);
            expect(await service.getVersionForOutput(taskId, 'output_0')).not.toBeNull();
            let finishRead!: () => void;
            readOriginal.mockImplementationOnce(() => new Promise(resolve => {
                finishRead = () => resolve({ bytes: png });
            }));
            const pendingRead = service.readOutput(taskId, 'output_0');
            await settle(async () => Boolean(finishRead));
            sourceCurrent = false;
            finishRead();
            await expect(pendingRead).rejects.toThrow('image_generation:source_changed');
            await expect(service.readOutput(taskId, 'output_0')).rejects.toThrow('image_generation:source_changed');
            expect(await service.getVersionForOutput(taskId, 'output_0')).toBeNull();
            expect((await service.get(taskId))?.state).toBe('completed');
            const restarted = makeService(store, provider, { assets: { readOriginal } as unknown as ImageAssetService });
            try {
                await expect(restarted.readOutput(taskId, 'output_0')).rejects.toThrow('image_generation:source_changed');
                expect(await restarted.getVersionForOutput(taskId, 'output_0')).toBeNull();
            } finally { restarted.dispose(); }
        } finally { service.dispose(); }
    });

    it('repairs a local saved version after provider results expire and connection changes', async () => {
        const store = await readyStore();
        const old = '2026-01-01T00:00:00.000Z';
        const ref = { assetId: 'saved_original', contentHash: 'c'.repeat(64) };
        await store.putImageGenerationTask({ schemaVersion: 1, taskId: 'task_local',
            operationId: 'operation_local', conversationId: input.conversationId, stableMessageId: input.stableMessageId,
            createdAt: old, updatedAt: old, revision: 0,
            request: { userPrompt: input.userPrompt, submittedPrompt: input.submittedPrompt,
                operation: 'generate', model: 'wan2.7-image', count: 1, inputRefs: [] },
            connection: { mode: connection.mode, endpointIdentity: connection.baseURL,
                credentialSlot: connection.credentialSlot, revision: connection.revision },
            state: 'prepared', outputs: [] });
        const claimed = await store.claimImageGenerationSubmission('task_local', 0, old);
        await store.putImageGenerationTask({ ...claimed!, state: 'running', revision: 2,
            providerTaskId: 'wan_old' }, 1);
        await store.putImageGenerationTask({ ...claimed!, state: 'saving', revision: 3,
            providerTaskId: 'wan_old', outputs: [{ outputId: 'output_0', providerOrdinal: 0,
                saveState: 'saved', assetRef: ref, recoveryReason: 'version_record_failed' }] }, 2);
        await store.putImageGenerationTask({ ...claimed!, state: 'partial', revision: 4,
            providerTaskId: 'wan_old', outputs: [{ outputId: 'output_0', providerOrdinal: 0,
                saveState: 'saved', assetRef: ref, recoveryReason: 'version_record_failed' }] }, 3);
        const provider = { submit: jest.fn(), query: jest.fn(), cancel: jest.fn() };
        const service = new ImageGenerationService({ store, assets: {} as ImageAssetService,
            resolveConnection: () => null, getToken: async () => null,
            providerFactory: () => provider as unknown as WanImageProvider });
        await service.resume('task_local');
        await settle(async () => (await service.get('task_local'))?.state === 'completed');
        expect((await service.getVersionForOutput('task_local', 'output_0'))?.assetRef).toEqual(ref);
        expect(provider.query).not.toHaveBeenCalled();
        service.dispose();
    });

    it('relinks a vault original saved before the task record after a crash, without provider access', async () => {
        const store = await readyStore();
        const old = '2026-01-01T00:00:00.000Z';
        const hash = await imageSourceHash(png);
        const ref = { assetId: 'crash_saved_original', contentHash: hash };
        await store.putImageAsset({ id: ref.assetId, source: 'imported', originalPath: 'pa-images/crash.png',
            originalHash: hash, byteLength: png.byteLength, detectedMime: 'image/png',
            acquisition: 'original_file', state: 'available', anchorPath: 'PA Chat.md',
            anchorKind: 'logical_root', createdAt: Date.parse(old), owners: [], importDirectory: 'pa-images' });
        await store.putImageGenerationTask({ schemaVersion: 1, taskId: 'task_crash_saved',
            operationId: 'operation_crash_saved', conversationId: input.conversationId,
            stableMessageId: input.stableMessageId, createdAt: old, updatedAt: old, revision: 0,
            request: { userPrompt: input.userPrompt, submittedPrompt: input.submittedPrompt,
                operation: 'generate', model: 'wan2.7-image', count: 1, inputRefs: [] },
            connection: { mode: connection.mode, endpointIdentity: connection.baseURL,
                credentialSlot: connection.credentialSlot, revision: connection.revision },
            state: 'prepared', outputs: [] });
        const claimed = await store.claimImageGenerationSubmission('task_crash_saved', 0, old);
        await store.putImageGenerationTask({ ...claimed!, state: 'running', revision: 2,
            providerTaskId: 'wan_expired' }, 1);
        await store.putImageGenerationTask({ ...claimed!, state: 'saving', revision: 3,
            providerTaskId: 'wan_expired', outputs: [{ outputId: 'output_0', providerOrdinal: 0,
                saveState: 'saving', expectedContentHash: hash }] }, 2);
        const provider = { submit: jest.fn(), query: jest.fn(), cancel: jest.fn() };
        const readOriginal = jest.fn(async (_ref?: unknown, _purpose?: unknown) => ({ bytes: png }));
        const service = new ImageGenerationService({ store,
            assets: { readOriginal } as unknown as ImageAssetService,
            resolveConnection: () => null, getToken: async () => null,
            providerFactory: () => provider as unknown as WanImageProvider });
        await service.recover();
        await settle(async () => (await service.get('task_crash_saved'))?.state === 'completed');
        expect((await service.get('task_crash_saved'))?.outputs[0].assetRef).toEqual(ref);
        expect((await service.getVersionForOutput('task_crash_saved', 'output_0'))?.assetRef).toEqual(ref);
        expect(readOriginal).toHaveBeenCalledWith(ref, 'note');
        expect(provider.query).not.toHaveBeenCalled();
        expect(provider.submit).not.toHaveBeenCalled();
        service.dispose();
    });
});
