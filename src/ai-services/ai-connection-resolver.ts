import type {
    AIConnection,
    AIConnectionIssue,
    AIConnectionResolution,
    AIConnectionsSettings,
    AIPurpose,
} from "./ai-connection-types";
import { getProviderDefinition } from "./provider-definitions";

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function unavailable(issue: AIConnectionIssue, connectionId?: string): AIConnectionResolution {
    return connectionId === undefined ? { ok: false, issue } : { ok: false, issue, connectionId };
}

export function isHttpEndpoint(value: string): boolean {
    if (!/^https?:\/\//i.test(value) || /\s/.test(value)) return false;
    try {
        const endpoint = new URL(value);
        return (endpoint.protocol === "https:" || endpoint.protocol === "http:")
            && Boolean(endpoint.hostname) && !endpoint.username && !endpoint.password;
    } catch {
        return false;
    }
}

/** Resolve the persisted selection without touching credentials or trying another service. */
export function resolveAIConnection(
    settings: AIConnectionsSettings | undefined,
    purpose: AIPurpose,
): AIConnectionResolution {
    if (settings === undefined) return unavailable("connection_unconfigured");
    if (!isRecord(settings) || settings.schemaVersion !== 1
        || !Array.isArray(settings.connections) || !isRecord(settings.bindings)) {
        return unavailable("configuration_invalid");
    }

    const binding = settings.bindings[purpose];
    if (!isRecord(binding)) return unavailable("configuration_invalid");
    if (binding.mode === "unconfigured") return unavailable("connection_unconfigured");

    let connectionId: string;
    if (binding.mode === "inherit") {
        if (settings.defaultConnectionId === null) return unavailable("connection_unconfigured");
        if (!nonEmptyString(settings.defaultConnectionId)) return unavailable("configuration_invalid");
        connectionId = settings.defaultConnectionId;
    } else if (binding.mode === "connection" && nonEmptyString(binding.connectionId)) {
        connectionId = binding.connectionId;
    } else {
        return unavailable("configuration_invalid");
    }

    const matching = settings.connections.filter(connection => isRecord(connection) && connection.id === connectionId);
    if (matching.length === 0) return unavailable("connection_missing", connectionId);
    if (matching.length !== 1) return unavailable("configuration_invalid", connectionId);
    const connection = matching[0];
    const definition = getProviderDefinition(connection.providerId);
    if (!definition) return unavailable("provider_unsupported", connectionId);
    const adapter = definition.adapters[purpose];
    if (!adapter) return unavailable("capability_unsupported", connectionId);

    const endpoint = connection.endpoints?.[purpose];
    if (endpoint === undefined || (typeof endpoint === "string" && !endpoint.trim())) {
        return unavailable("endpoint_missing", connectionId);
    }
    if (typeof endpoint !== "string" || !isHttpEndpoint(endpoint.trim())) {
        return unavailable("configuration_invalid", connectionId);
    }
    const model = connection.models?.[purpose];
    if (model === undefined || (typeof model === "string" && !model.trim())) {
        return unavailable("model_missing", connectionId);
    }
    if (!nonEmptyString(model) || !nonEmptyString(connection.name) || !nonEmptyString(connection.secretRef)
        || !Number.isSafeInteger(connection.revision) || connection.revision < 0 || !isRecord(connection.options)) {
        return unavailable("configuration_invalid", connectionId);
    }

    if (purpose === "embedding" && connection.options.embeddingDimensions !== undefined
        && (!Number.isSafeInteger(connection.options.embeddingDimensions) || connection.options.embeddingDimensions <= 0)) {
        return unavailable("configuration_invalid", connectionId);
    }
    if (purpose === "chat" && connection.options.chat !== undefined && !isRecord(connection.options.chat)) {
        return unavailable("configuration_invalid", connectionId);
    }
    const policy = connection.models.policy;
    if (purpose === "chat" && policy !== undefined && typeof policy !== "string") {
        return unavailable("configuration_invalid", connectionId);
    }

    return {
        ok: true,
        connection: {
            purpose,
            connectionId,
            name: connection.name,
            providerId: definition.id,
            endpoint: endpoint.trim(),
            model: model.trim(),
            secretRef: connection.secretRef,
            revision: connection.revision,
            adapter,
            // Settings are JSON data; keep later edits from mutating this request snapshot.
            options: JSON.parse(JSON.stringify(connection.options)) as AIConnection["options"],
            ...(purpose === "chat" ? { policyModel: policy?.trim() || model.trim() } : {}),
        },
    };
}
