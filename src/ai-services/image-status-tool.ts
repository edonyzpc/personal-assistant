import type { ChatToolDefinition } from './chat-tool-types';
import { throwIfAborted } from './chat-utils';
import type { GetImageStatusInput, ImageStatusObservation } from '../chat/image-generation-status';

export type { GetImageStatusInput, ImageStatusObservation } from '../chat/image-generation-status';
export { isImageStatusObservation } from '../chat/image-generation-status';

export const GET_IMAGE_STATUS = 'get_image_status';

export interface ImageStatusHost {
    /** The Host binds conversation, task visibility and current network admission. */
    read(input: GetImageStatusInput, signal?: AbortSignal): Promise<ImageStatusObservation>;
}

export function createImageStatusTool(host: ImageStatusHost): ChatToolDefinition<GetImageStatusInput, ImageStatusObservation> {
    return {
        name: GET_IMAGE_STATUS,
        description: 'Read the status of an existing image task. Use its taskId or submission operationId, exactly one. Set refresh=true only to query the original provider once; this never starts or resumes image generation.',
        plannerGuidance: [
            'For an accepted create_image receipt, copy observation.taskId exactly into taskId. Use operationId only for an explicitly returned submission operationId, not the generic domainIdentity.operationId, which may name the task. Never reconstruct or alter an identity; if a lookup is unavailable, check it against the original receipt before drawing a conclusion.',
            'A local snapshot is the latest saved task state, not a fresh provider response. Inspect basis and remoteQueryReason.',
            'For localState=submission_unknown, provider acceptance and charges are unverified, not failed. no_provider_task means no remote verification is available; nextAction=needs_user does not request confirmation or resubmission. Explain the uncertainty and available ways to verify the original task, then stop. Until the original task is confirmed failed, do not suggest or offer a replacement generation, or ask whether the user wants to regenerate. An accepted create_image receipt confirms a local task, not provider acceptance or image delivery.',
            'An unavailable lookup is not a failed generation. Preserve the last verified task facts, explain the lookup limit, and do not invite a replacement generation because no record was returned.',
            'Provider success does not establish local image delivery. Respect localState; do not claim an image was saved from providerState alone.',
            'Respect nextAction and retryAfterMs. Do not poll repeatedly in the same turn or treat a status check as authorization to submit, resume, save or cancel.',
        ],
        inputSchema: {
            type: 'object', additionalProperties: false,
            properties: {
                taskId: { type: 'string', maxLength: 256, description: 'Existing local image task ID. Omit operationId.' },
                operationId: { type: 'string', maxLength: 256, description: 'Existing submission operation ID. Omit taskId.' },
                refresh: { type: 'boolean', description: 'Request one provider status read when the Host permits it; default false.' },
            },
        },
        // The optional refresh path performs a network read. The bound Host
        // checks that permission again; local snapshots never contact a provider.
        permission: 'network-read', cost: 'network-calls', outputBudgetChars: 2400,
        requiresConfirmation: false, failureBehavior: 'recoverable',
        statusMessageText: 'Checking image status', sourceBoundary: 'read-only-tool',
        statusMessage: () => 'Checking image status',
        validateInput: raw => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Image status input must be an object.');
            const value = raw as Record<string, unknown>;
            if (Object.keys(value).some(key => !['taskId', 'operationId', 'refresh'].includes(key))
                || (value.taskId !== undefined) === (value.operationId !== undefined)
                || (value.refresh !== undefined && typeof value.refresh !== 'boolean')) {
                throw new Error('Image status requires exactly one taskId or operationId and an optional boolean refresh.');
            }
            const key = value.taskId !== undefined ? 'taskId' : 'operationId';
            const id = value[key];
            if (typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,256}$/.test(id)) throw new Error('Invalid image status identity.');
            const reference = key === 'taskId' ? { taskId: id } : { operationId: id };
            return { ...reference, ...(value.refresh === undefined ? {} : { refresh: value.refresh }) };
        },
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const content = await host.read(input, context.signal);
            throwIfAborted(context.signal);
            return { ok: true, tool: GET_IMAGE_STATUS, inputSummary: 'Existing image task status', content, sources: [] };
        },
    };
}
