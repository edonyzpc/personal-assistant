import { getDashScopeImageGenerationEndpoint } from './ai-utils';
import { resolveWanImageEndpoints } from './wan-image-provider';

export type ImageGenerationConnectionMode = 'inherit-chat' | 'dedicated-wan';

export interface ImageGenerationConnectionSettings {
    aiProvider: string;
    baseURL: string;
    imageGenerationConnectionMode: ImageGenerationConnectionMode;
    imageGenerationBaseURL: string;
    imageGenerationConnectionRevision: number;
}

export interface ImageGenerationConnection {
    mode: ImageGenerationConnectionMode;
    baseURL: string;
    synchronousEndpoint: string;
    asynchronousEndpoint: string;
    tasksEndpoint: string;
    credentialSlot: string;
    revision: number;
}

export function resolveWanSynchronousEndpoint(baseURL: string): string {
    const endpoints = resolveWanImageEndpoints(baseURL);
    return getDashScopeImageGenerationEndpoint(baseURL)
        ?? new URL('/api/v1/services/aigc/multimodal-generation/generation', endpoints.submit).toString();
}

/** Resolve only known Wan endpoints. A custom Chat URL never inherits image authority. */
export function resolveImageGenerationConnection(
    settings: ImageGenerationConnectionSettings,
    credentialSlots: { chat: string; dedicated: string },
): ImageGenerationConnection {
    const mode = settings.imageGenerationConnectionMode;
    if (mode !== 'inherit-chat' && mode !== 'dedicated-wan') {
        throw new Error('image_generation:invalid_connection_mode');
    }
    const baseURL = mode === 'inherit-chat' ? settings.baseURL : settings.imageGenerationBaseURL;
    if (mode === 'inherit-chat'
        && (settings.aiProvider !== 'qwen' || !getDashScopeImageGenerationEndpoint(baseURL))) {
        throw new Error('image_generation:incompatible_chat_connection');
    }
    const endpoints = resolveWanImageEndpoints(baseURL);
    const synchronousEndpoint = resolveWanSynchronousEndpoint(baseURL);
    return {
        mode,
        baseURL: baseURL.trim().replace(/\/+$/, ''),
        synchronousEndpoint,
        asynchronousEndpoint: endpoints.submit,
        tasksEndpoint: endpoints.tasks,
        credentialSlot: mode === 'inherit-chat' ? credentialSlots.chat : credentialSlots.dedicated,
        revision: settings.imageGenerationConnectionRevision,
    };
}
