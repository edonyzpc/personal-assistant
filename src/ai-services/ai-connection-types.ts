/** Shared data contracts for saved AI connections. Secret values never belong here. */
export type AIPurpose = "chat" | "embedding" | "image";

export type PurposeBinding =
    | { mode: "inherit" }
    | { mode: "connection"; connectionId: string }
    | { mode: "unconfigured" };

export interface AIConnection {
    id: string;
    name: string;
    providerId: string;
    region?: string;
    endpoints: { chat?: string; embedding?: string; image?: string };
    secretRef: string;
    /** Only newly allocated slots have proven ownership; legacy references stay conservative. */
    secretOwned?: boolean;
    models: {
        chat?: string;
        policy?: string;
        embedding?: string;
        image?: string;
        sourceImage?: string;
    };
    options: {
        embeddingDimensions?: number;
        chat?: Record<string, unknown>;
    };
    revision: number;
}

export interface AIConnectionsSettings {
    schemaVersion: 1;
    connections: AIConnection[];
    defaultConnectionId: string | null;
    bindings: Record<AIPurpose, PurposeBinding>;
    memorySelection: {
        revision: string;
        cause: "initial-setup" | "configuration-change" | "migration";
    };
    migrationVersion: number;
}

export type AIConnectionIssue =
    | "connection_unconfigured"
    | "connection_missing"
    | "provider_unsupported"
    | "capability_unsupported"
    | "endpoint_missing"
    | "model_missing"
    | "configuration_invalid";

export interface ResolvedAIConnection {
    purpose: AIPurpose;
    connectionId: string;
    name: string;
    providerId: string;
    endpoint: string;
    model: string;
    secretRef: string;
    revision: number;
    adapter: "openai-compatible" | "openai-image" | "wan";
    options: AIConnection["options"];
    policyModel?: string;
}

export type AIConnectionResolution =
    | { ok: true; connection: ResolvedAIConnection }
    | { ok: false; issue: AIConnectionIssue; connectionId?: string };
