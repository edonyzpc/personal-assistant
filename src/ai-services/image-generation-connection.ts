import { getDashScopeImageGenerationEndpoint } from './ai-utils';
import { resolveWanImageEndpoints } from './wan-image-provider';
import { resolveOpenAIImageBaseURL } from './openai-image-provider';
import { resolveAIConnection } from './ai-connection-resolver';
import type { AIConnectionsSettings } from './ai-connection-types';

export type ImageGenerationConnectionMode = 'inherit-chat' | 'dedicated-wan';

export interface ImageGenerationConnectionSettings {
    aiConnections?: AIConnectionsSettings;
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
    connectionId?: string;
    providerId?: string;
    adapter?: 'wan' | 'openai-image';
    model?: string;
    sourceImageModel?: string;
    credentialRevision?: number;
}

export interface LegacyImageConnectionReference {
    mode: ImageGenerationConnectionMode;
    endpointIdentity: string;
    credentialSlot: string;
    revision: number;
}

/** Only image request inputs participate; other models and display names do not revoke this work. */
export function imageGenerationConnectionIdentity(connection: ImageGenerationConnection): string {
    return connection.connectionId
        ? JSON.stringify([connection.connectionId, connection.providerId, connection.adapter, connection.baseURL,
            connection.model, connection.sourceImageModel, connection.credentialSlot, connection.credentialRevision ?? 0])
        : JSON.stringify([connection.mode, connection.baseURL, connection.credentialSlot, connection.revision]);
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
    connectionId?: string,
): ImageGenerationConnection {
    if (settings.aiConnections !== undefined) {
        const config = settings.aiConnections;
        const resolution = resolveAIConnection(connectionId && config ? { ...config,
            bindings: { ...config.bindings, image: { mode: 'connection', connectionId } } } : config, 'image');
        if (!resolution.ok) throw new Error(`image_generation:${resolution.issue}`);
        const resolved = resolution.connection;
        const saved = config!.connections.find(item => item.id === resolved.connectionId)!;
        const baseURL = resolved.endpoint.replace(/\/+$/, '');
        const mode = config!.bindings.image.mode === 'inherit' ? 'inherit-chat' : 'dedicated-wan';
        const endpoints = resolved.adapter === 'openai-image'
            ? { synchronousEndpoint: `${resolveOpenAIImageBaseURL(baseURL)}/images/generations`,
                asynchronousEndpoint: '', tasksEndpoint: '' }
            : { synchronousEndpoint: resolveWanSynchronousEndpoint(baseURL),
                asynchronousEndpoint: resolveWanImageEndpoints(baseURL).submit,
                tasksEndpoint: resolveWanImageEndpoints(baseURL).tasks };
        return { mode, baseURL, ...endpoints, credentialSlot: resolved.secretRef, revision: resolved.revision,
            connectionId: resolved.connectionId, providerId: resolved.providerId,
            adapter: resolved.adapter as 'wan' | 'openai-image', model: resolved.model,
            sourceImageModel: saved.models.sourceImage ?? resolved.model };
    }
    if (connectionId) throw new Error('image_generation:connection_missing');
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
