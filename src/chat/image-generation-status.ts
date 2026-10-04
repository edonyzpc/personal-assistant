import { z } from 'zod';
import type { ImageGenerationTask } from './image-generation-types';

export type GetImageStatusInput = (
    | { taskId: string; operationId?: never }
    | { operationId: string; taskId?: never }
) & { refresh?: boolean };

export type ImageStatusTaskIdentity = Pick<ImageGenerationTask, 'taskId' | 'operationId'
    | 'conversationId' | 'stableMessageId'>;

/** Host-owned admission. A historical task keeps its original message identity. */
export interface ImageStatusReadScope {
    conversationId: string;
    isCurrent(): boolean;
    canReadTask(task: ImageStatusTaskIdentity): boolean;
    canQueryProvider(): boolean;
    signal?: AbortSignal;
}

const refreshReason = z.enum(['no_provider_task', 'network_not_allowed', 'connection_changed',
    'credential_unavailable', 'provider_unavailable', 'task_changed']);
export type ImageStatusRefreshReason = z.infer<typeof refreshReason>;

/** Recovery facts for which the image owner deliberately stops scheduling this task. */
const blockingReason = z.enum(['credential_unavailable', 'connection_changed', 'source_changed',
    'transparent_input_needs_confirmation']);
export type ImageStatusBlockingReason = z.infer<typeof blockingReason>;

/** Finite, body-free output also used when admitting a serialized status observation. */
export const imageStatusObservationSchema = z.union([
    z.object({ status: z.literal('unavailable'), reason: z.literal('task_unavailable') }).strict(),
    z.object({
        status: z.literal('available'),
        taskId: z.string().regex(/^[A-Za-z0-9:_-]{1,256}$/),
        operationId: z.string().regex(/^[A-Za-z0-9:_-]{1,256}$/),
        localState: z.enum(['prepared', 'not_submitted', 'submitting', 'submission_unknown',
            'running', 'saving', 'completed', 'partial', 'failed', 'stopped', 'expired']),
        revision: z.number().int().nonnegative(),
        updatedAt: z.string().max(64),
        basis: z.enum(['local_snapshot', 'provider_query']),
        providerState: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'UNKNOWN']).optional(),
        remoteQueryAvailable: z.boolean(),
        remoteQueryReason: refreshReason.optional(),
        blockingReason: blockingReason.optional(),
        checkedAt: z.string().max(64).optional(),
        nextAction: z.enum(['wait', 'needs_user', 'none']),
        retryAfterMs: z.number().int().nonnegative().optional(),
    }).strict(),
]);

export type ImageStatusObservation = z.infer<typeof imageStatusObservationSchema>;

export function isImageStatusObservation(value: unknown): value is ImageStatusObservation {
    return imageStatusObservationSchema.safeParse(value).success;
}
