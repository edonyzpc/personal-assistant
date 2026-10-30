import { VSS_DEFAULT_DIMENSIONS } from "../vss/types";
import type { AIConnection, AIPurpose, ResolvedAIConnection } from "./ai-connection-types";

export type ConnectionDefaults = Pick<AIConnection, "providerId" | "region" | "endpoints" | "models" | "options">;

export interface ProviderDefinition {
    readonly id: string;
    readonly name: string;
    readonly secretSlug: string;
    readonly adapters: Readonly<Partial<Record<AIPurpose, ResolvedAIConnection["adapter"]>>>;
    readonly defaults: ConnectionDefaults;
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DASHSCOPE_CN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DASHSCOPE_INTL_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

function dashScopeDefinition(id: string, region: string, name: string, baseURL: string): ProviderDefinition {
    return {
        id,
        name,
        secretSlug: id,
        adapters: { chat: "openai-compatible", embedding: "openai-compatible", image: "wan" },
        defaults: {
            providerId: id,
            region,
            // The existing Wan adapter resolves its own submit/query URLs from this API base.
            endpoints: { chat: baseURL, embedding: baseURL, image: baseURL },
            models: { chat: "qwen3.6-plus", embedding: "text-embedding-v4", image: "wan2.7-image" },
            options: { embeddingDimensions: VSS_DEFAULT_DIMENSIONS },
        },
    };
}

const DEFINITIONS: ReadonlyMap<string, ProviderDefinition> = new Map([
    ["openai", {
        id: "openai",
        name: "OpenAI",
        secretSlug: "openai",
        adapters: { chat: "openai-compatible", embedding: "openai-compatible", image: "openai-image" },
        defaults: {
            providerId: "openai",
            endpoints: { chat: OPENAI_BASE_URL, embedding: OPENAI_BASE_URL, image: OPENAI_BASE_URL },
            models: { chat: "gpt-4o-mini", embedding: "text-embedding-3-small", image: "gpt-image-2.5-flare" },
            options: { embeddingDimensions: VSS_DEFAULT_DIMENSIONS },
        },
    }],
    ["dashscope-cn", dashScopeDefinition("dashscope-cn", "cn", "DashScope", DASHSCOPE_CN_BASE_URL)],
    ["dashscope-intl", dashScopeDefinition("dashscope-intl", "intl", "DashScope International", DASHSCOPE_INTL_BASE_URL)],
    ["custom", {
        id: "custom",
        name: "Custom (OpenAI-compatible)",
        secretSlug: "custom",
        adapters: { chat: "openai-compatible", embedding: "openai-compatible" },
        defaults: {
            providerId: "custom",
            endpoints: {},
            models: {},
            options: { embeddingDimensions: VSS_DEFAULT_DIMENSIONS },
        },
    }],
]);

/** Protocol support is not proof of a model's Agent capabilities or an account's access. */
export function getProviderDefinition(id: string): ProviderDefinition | undefined {
    return DEFINITIONS.get(id);
}

export function getProviderDefinitions(): readonly ProviderDefinition[] {
    return Array.from(DEFINITIONS.values());
}

/** Defaults apply when creating a connection, never when repairing saved empty values. */
export function createConnectionDefaults(providerId: string): ConnectionDefaults {
    const definition = getProviderDefinition(providerId);
    if (!definition) throw new Error("Unknown AI provider");
    const defaults = definition.defaults;
    return {
        ...defaults,
        endpoints: { ...defaults.endpoints },
        models: { ...defaults.models },
        options: { ...defaults.options },
    };
}
