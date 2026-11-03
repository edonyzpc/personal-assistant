import { resolveAIConnection } from "./ai-connection-resolver";
import type {
    AIConnection,
    AIConnectionsSettings,
    AIConnectionIssue,
    AIPurpose,
    PurposeBinding,
    ResolvedAIConnection,
} from "./ai-connection-types";
import { createConnectionDefaults, getProviderDefinition } from "./provider-definitions";

export type AIConnectionSelectionPatch = {
    defaultConnectionId?: string | null;
    bindings?: Partial<Record<AIPurpose, PurposeBinding>>;
};

export interface AIConnectionSelectionInput {
    providerId: string;
    name?: string;
    region?: string;
    endpoints?: AIConnection["endpoints"];
    models?: AIConnection["models"];
    options?: AIConnection["options"];
}

export type AIConnectionSelectionEffective =
    | {
        ok: true;
        connectionId: string;
        providerId: string;
        adapter: ResolvedAIConnection["adapter"];
        endpoint: string;
        model: string;
        policyModel?: string;
        sourceImageModel?: string;
        embeddingDimensions?: number;
        chatOptions?: Record<string, unknown>;
    }
    | {
        ok: false;
        issue: AIConnectionIssue;
        connectionId?: string;
    };

export interface AIConnectionSelectionPurposeImpact {
    purpose: AIPurpose;
    beforeBinding: PurposeBinding;
    afterBinding: PurposeBinding;
    before: AIConnectionSelectionEffective;
    after: AIConnectionSelectionEffective;
    semanticChanged: boolean;
    effectiveChanged: boolean;
}

export interface AIConnectionSelectionImpact {
    defaultConnection?: {
        before: string | null;
        after: string | null;
        changed: boolean;
    };
    purposes: AIConnectionSelectionPurposeImpact[];
}

export interface AIConnectionSelectionPreview {
    patch: AIConnectionSelectionPatch;
    impact: AIConnectionSelectionImpact;
}

export type AIConnectionSelectionResult =
    | { status: "applied" }
    | { status: "preview-changed"; preview: AIConnectionSelectionPreview };

export interface AIConnectionCreationPreview extends AIConnectionSelectionPreview {
    input: AIConnectionSelectionInput;
    usage: "default" | AIPurpose;
}

const PURPOSES: readonly AIPurpose[] = ["chat", "embedding", "image"];
const PENDING_CONNECTION_ID = "__pa-pending-ai-connection__";

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeBinding(value: unknown, purpose: AIPurpose): PurposeBinding {
    if (!isRecord(value)) throw new Error("ai_connection:binding_invalid");
    if (value.mode === "inherit") return { mode: "inherit" };
    if (value.mode === "unconfigured") return { mode: "unconfigured" };
    if (value.mode === "connection" && typeof value.connectionId === "string" && value.connectionId) {
        return { mode: "connection", connectionId: value.connectionId };
    }
    throw new Error(`ai_connection:binding_invalid:${purpose}`);
}

export function normalizeSelectionPatch(patch: AIConnectionSelectionPatch): AIConnectionSelectionPatch {
    const normalized: AIConnectionSelectionPatch = {};
    if ("defaultConnectionId" in patch) {
        if (patch.defaultConnectionId !== null && typeof patch.defaultConnectionId !== "string") {
            throw new Error("ai_connection:default_invalid");
        }
        normalized.defaultConnectionId = patch.defaultConnectionId;
    }
    if (patch.bindings !== undefined) {
        normalized.bindings = {};
        for (const purpose of PURPOSES) {
            if (patch.bindings[purpose] !== undefined) {
                normalized.bindings[purpose] = normalizeBinding(patch.bindings[purpose], purpose);
            }
        }
    }
    return normalized;
}

function applySelectionPatch(
    settings: AIConnectionsSettings,
    patch: AIConnectionSelectionPatch,
): AIConnectionsSettings {
    const next = clone(settings);
    if ("defaultConnectionId" in patch) next.defaultConnectionId = patch.defaultConnectionId ?? null;
    for (const purpose of PURPOSES) {
        const binding = patch.bindings?.[purpose];
        if (binding !== undefined) next.bindings[purpose] = clone(binding);
    }
    return next;
}

function effectiveFact(settings: AIConnectionsSettings, purpose: AIPurpose): AIConnectionSelectionEffective {
    const resolution = resolveAIConnection(settings, purpose);
    if (!resolution.ok) {
        return {
            ok: false,
            issue: resolution.issue,
            ...(resolution.connectionId === undefined ? {} : { connectionId: resolution.connectionId }),
        };
    }
    const connection = resolution.connection;
    const source = settings.connections.find(item => item.id === connection.connectionId);
    return {
        ok: true,
        connectionId: connection.connectionId,
        providerId: connection.providerId,
        adapter: connection.adapter,
        endpoint: connection.endpoint,
        model: connection.model,
        ...(purpose === "chat" ? { policyModel: connection.policyModel } : {}),
        ...(purpose === "chat" && source?.options.chat ? { chatOptions: clone(source.options.chat) } : {}),
        ...(purpose === "embedding" && source?.options.embeddingDimensions !== undefined
            ? { embeddingDimensions: source.options.embeddingDimensions } : {}),
        ...(purpose === "image" && source?.models.sourceImage !== undefined
            ? { sourceImageModel: source.models.sourceImage } : {}),
    };
}

function selectionImpact(
    before: AIConnectionsSettings,
    after: AIConnectionsSettings,
    patch: AIConnectionSelectionPatch,
): AIConnectionSelectionImpact {
    const impact: AIConnectionSelectionImpact = { purposes: [] };
    if ("defaultConnectionId" in patch) {
        impact.defaultConnection = {
            before: before.defaultConnectionId,
            after: after.defaultConnectionId,
            changed: before.defaultConnectionId !== after.defaultConnectionId,
        };
    }
    for (const purpose of PURPOSES) {
        const beforeBinding = before.bindings[purpose];
        const afterBinding = after.bindings[purpose];
        const beforeEffective = effectiveFact(before, purpose);
        const afterEffective = effectiveFact(after, purpose);
        const semanticChanged = !sameValue(beforeBinding, afterBinding);
        const effectiveChanged = !sameValue(beforeEffective, afterEffective);
        if (patch.bindings?.[purpose] === undefined && !semanticChanged && !effectiveChanged) continue;
        impact.purposes.push({
            purpose,
            beforeBinding: clone(beforeBinding),
            afterBinding: clone(afterBinding),
            before: beforeEffective,
            after: afterEffective,
            semanticChanged,
            effectiveChanged,
        });
    }
    return impact;
}

export function createSelectionPreview(
    settings: AIConnectionsSettings,
    submittedPatch: AIConnectionSelectionPatch,
): AIConnectionSelectionPreview {
    const patch = normalizeSelectionPatch(submittedPatch);
    const next = applySelectionPatch(settings, patch);
    return {
        patch,
        impact: selectionImpact(settings, next, patch),
    };
}

export function selectionImpactEqual(left: AIConnectionSelectionImpact, right: AIConnectionSelectionImpact): boolean {
    return sameValue(left, right);
}

export function selectionChangesSettings(
    before: AIConnectionsSettings,
    submittedPatch: AIConnectionSelectionPatch,
): boolean {
    const patch = normalizeSelectionPatch(submittedPatch);
    const after = applySelectionPatch(before, patch);
    return before.defaultConnectionId !== after.defaultConnectionId
        || PURPOSES.some(purpose => !sameValue(before.bindings[purpose], after.bindings[purpose]));
}

export function applyNormalizedSelectionPatch(
    settings: AIConnectionsSettings,
    submittedPatch: AIConnectionSelectionPatch,
): AIConnectionsSettings {
    return applySelectionPatch(settings, normalizeSelectionPatch(submittedPatch));
}

function virtualConnection(input: AIConnectionSelectionInput): AIConnection {
    const definition = getProviderDefinition(input.providerId);
    if (!definition) throw new Error("ai_connection:provider_unsupported");
    const defaults = createConnectionDefaults(input.providerId);
    return {
        ...defaults,
        id: PENDING_CONNECTION_ID,
        name: definition.name,
        endpoints: { ...defaults.endpoints, ...input.endpoints },
        models: { ...defaults.models, ...input.models },
        options: { ...defaults.options, ...input.options },
        secretRef: "__pa_non_secret_preview__",
        secretOwned: false,
        revision: 0,
    };
}

export function createCreationPreview(
    settings: AIConnectionsSettings,
    input: AIConnectionSelectionInput,
    usage: "default" | AIPurpose,
): AIConnectionCreationPreview {
    const connection = virtualConnection(input);
    const after: AIConnectionsSettings = {
        ...settings,
        connections: [...settings.connections, connection],
    };
    const patch = usage === "default"
        ? { defaultConnectionId: connection.id }
        : { bindings: { [usage]: { mode: "connection" as const, connectionId: connection.id } } };
    const normalizedPatch = normalizeSelectionPatch(patch);
    const projected = applySelectionPatch(after, normalizedPatch);
    return {
        patch: normalizedPatch,
        impact: selectionImpact(settings, projected, normalizedPatch),
        input: clone(input),
        usage,
    };
}

export function creationPreviewMatches(
    preview: AIConnectionCreationPreview,
    settings: AIConnectionsSettings,
    input: AIConnectionSelectionInput,
    usage: "default" | AIPurpose,
): boolean {
    return preview.usage === usage
        && selectionImpactEqual(preview.impact, createCreationPreview(settings, input, usage).impact);
}
