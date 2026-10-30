import { resolveImageGenerationConnection, type ImageGenerationConnectionSettings } from '../src/ai-services/image-generation-connection';
import { createConnectionDefaults } from '../src/ai-services/provider-definitions';

const base: ImageGenerationConnectionSettings = {
    aiProvider: 'qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    imageGenerationConnectionMode: 'inherit-chat',
    imageGenerationBaseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    imageGenerationConnectionRevision: 3,
};
const slots = { chat: 'vault-chat-token', dedicated: 'vault-image-token' };

describe('image generation connection', () => {
    it('inherits only a compatible Chat connection and preserves its credential slot', () => {
        const connection = resolveImageGenerationConnection(base, slots);
        expect(connection.mode).toBe('inherit-chat');
        expect(connection.credentialSlot).toBe(slots.chat);
        expect(connection.revision).toBe(3);
        expect(connection.asynchronousEndpoint).toContain('dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation');
        expect(() => resolveImageGenerationConnection({ ...base, aiProvider: 'openai' }, slots))
            .toThrow('image_generation:incompatible_chat_connection');
    });

    it('keeps a dedicated Wan connection when Chat changes provider', () => {
        const connection = resolveImageGenerationConnection({ ...base, aiProvider: 'openai',
            baseURL: 'https://api.openai.com/v1', imageGenerationConnectionMode: 'dedicated-wan' }, slots);
        expect(connection.credentialSlot).toBe(slots.dedicated);
        expect(connection.baseURL).toBe(base.imageGenerationBaseURL);
        expect(connection.synchronousEndpoint).toContain('dashscope-intl.aliyuncs.com');
    });

    it('rejects arbitrary dedicated endpoints before any credential can be used', () => {
        expect(() => resolveImageGenerationConnection({ ...base, imageGenerationConnectionMode: 'dedicated-wan',
            imageGenerationBaseURL: 'https://example.com' }, slots)).toThrow();
    });

    it('resolves a saved OpenAI image connection independently of Chat and can locate an original connection by ID', () => {
        const connections = [
            { ...createConnectionDefaults('openai'), id: 'openai', name: 'OpenAI', secretRef: 'openai-key', revision: 1 },
            { ...createConnectionDefaults('dashscope-cn'), id: 'dashscope', name: 'DashScope', secretRef: 'dashscope-key', revision: 1 },
        ];
        const settings: ImageGenerationConnectionSettings = { ...base, aiConnections: {
            schemaVersion: 1, migrationVersion: 1, connections, defaultConnectionId: 'openai',
            bindings: { chat: { mode: 'connection', connectionId: 'dashscope' }, embedding: { mode: 'inherit' }, image: { mode: 'inherit' } },
            memorySelection: { revision: 'one', cause: 'configuration-change' },
        } };
        expect(resolveImageGenerationConnection(settings, slots)).toMatchObject({
            connectionId: 'openai', adapter: 'openai-image', credentialSlot: 'openai-key', model: 'gpt-image-2.5-flare',
            synchronousEndpoint: 'https://api.openai.com/v1/images/generations', tasksEndpoint: '',
        });
        expect(resolveImageGenerationConnection(settings, slots, 'dashscope')).toMatchObject({
            connectionId: 'dashscope', adapter: 'wan', credentialSlot: 'dashscope-key',
        });
    });
});
