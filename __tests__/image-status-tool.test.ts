import { describe, expect, it, jest } from '@jest/globals';
import { createImageStatusTool, GET_IMAGE_STATUS, isImageStatusObservation, type ImageStatusHost } from '../src/ai-services/image-status-tool';
import type { ChatToolContext } from '../src/ai-services/chat-tool-types';
import type { ImageStatusObservation } from '../src/chat/image-generation-status';
import { createChatToolCapability } from '../src/ai-services/capability-adapter';
import { PolicyEngine } from '../src/ai-services/policy-engine';

describe('get_image_status tool', () => {
    it('declares a network read and accepts exactly one local identity without Host-owned fields', () => {
        const tool = createImageStatusTool({ read: jest.fn<ImageStatusHost['read']>() });
        expect(tool.permission).toBe('network-read');
        expect(tool.cost).toBe('network-calls');
        expect(new PolicyEngine().canExport(createChatToolCapability(tool, { providerId: 'chat-image-status' }))).toMatchObject({ allowed: true });
        expect(tool.validateInput({ taskId: 'task_one' })).toEqual({ taskId: 'task_one' });
        expect(tool.validateInput({ operationId: 'op_one-sub2', refresh: true })).toEqual({ operationId: 'op_one-sub2', refresh: true });
        for (const input of [{}, { taskId: 'a', operationId: 'b' }, { taskId: '' }, { taskId: '../task' },
            { taskId: 'a', refresh: 'yes' }, { taskId: 'a', conversationId: 'foreign' },
            { providerTaskId: 'remote_task' }, { taskId: 'a', endpoint: 'https://different.invalid' }]) {
            expect(() => tool.validateInput(input)).toThrow();
        }
    });

    it('reads through the bound Host each time and preserves a finite unavailable observation', async () => {
        const observation: ImageStatusObservation = { status: 'unavailable', reason: 'task_unavailable' };
        const read = jest.fn<ImageStatusHost['read']>(async () => observation);
        const tool = createImageStatusTool({ read });
        const controller = new AbortController();
        const context = { signal: controller.signal } as ChatToolContext;
        const input = tool.validateInput({ taskId: 'task_one' });
        expect(await tool.execute(input, context)).toEqual({ ok: true, tool: GET_IMAGE_STATUS,
            inputSummary: 'Existing image task status', content: observation, sources: [] });
        await tool.execute(input, context);
        expect(read).toHaveBeenCalledTimes(2);
        expect(read).toHaveBeenLastCalledWith(input, controller.signal);
        expect(isImageStatusObservation(observation)).toBe(true);
        expect(isImageStatusObservation({ ...observation, prompt: 'unexpected body' })).toBe(false);
    });

    it('drops a result when the tool request is cancelled while the Host reads', async () => {
        const controller = new AbortController();
        const tool = createImageStatusTool({ read: async () => {
            controller.abort(); return { status: 'unavailable', reason: 'task_unavailable' };
        } });
        await expect(tool.execute({ taskId: 'task_one' }, { signal: controller.signal } as ChatToolContext))
            .rejects.toMatchObject({ name: 'AbortError' });
    });
});
