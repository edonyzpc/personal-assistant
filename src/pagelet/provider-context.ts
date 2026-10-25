import { stableStringify } from "../ai-services/agent-utils";
import { stableHash } from "../pa/helpers";

interface PageletProviderSettings {
    provider: string;
    model: string;
    embeddingModel: string;
    providerPreset: string | null;
    endpoint: string;
}

interface PageletProviderScope {
    excludedFolders: readonly string[];
    excludedTags: readonly string[];
    excludedPatterns: readonly string[];
    reviewsFolder: string;
}

function endpointIdentity(settings: PageletProviderSettings): string {
    return (settings.endpoint ?? "").trim().replace(/\/+$/, "");
}

export function getPageletProviderInfo(settings: PageletProviderSettings): {
    provider: string;
    model: string;
    endpoint: string;
} {
    const raw = endpointIdentity(settings);
    let endpoint = "Not configured";
    if (raw) {
        try {
            const url = new URL(raw);
            url.username = "";
            url.password = "";
            url.search = "";
            url.hash = "";
            endpoint = url.toString().replace(/\/+$/, "");
        } catch {
            endpoint = "Custom endpoint";
        }
    }
    return {
        provider: settings.provider || "Not configured",
        model: settings.model || "Default model",
        endpoint,
    };
}

export function getPageletProviderAuthorizationContextId(
    settings: PageletProviderSettings,
    scope: PageletProviderScope,
    dataBoundarySnapshotId: string,
): string {
    const provider = getPageletProviderInfo(settings);
    // Preserve the existing authorization identity for current provider calls.
    return `scope-recap-authorization:${stableHash(stableStringify({
        version: 2,
        provider: provider.provider,
        model: provider.model,
        embeddingModel: settings.embeddingModel || "Default embedding model",
        providerPreset: settings.providerPreset ?? null,
        endpoint: endpointIdentity(settings),
        dataBoundarySnapshotId,
        excludedFolders: [...scope.excludedFolders].sort(),
        excludedTags: [...scope.excludedTags].sort(),
        excludedPatterns: [...scope.excludedPatterns].sort(),
        reviewsFolder: scope.reviewsFolder,
    }))}`;
}
