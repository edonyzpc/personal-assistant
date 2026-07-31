import { stableStringify } from "../../ai-services/agent-utils";
import { stableHash } from "../../pa/helpers";
import {
    anchorSnapshotIdentity,
    sameSourceSnapshot,
} from "./anchor-snapshot";
import {
    PAGELET_DEEP_DISCOVER_PIPELINE_VERSION,
    PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS,
    PAGELET_NO_INSIGHT,
    type PageletAgentCacheIdentity,
    type PageletAgentPolicyIdentity,
    type PageletAgentSourceSnapshot,
    type PageletAgentVerifiedInsight,
    type PageletAnchorSnapshot,
} from "./types";

export interface PageletAgentCacheReadOptions {
    anchor: PageletAnchorSnapshot;
    policyIdentity: PageletAgentPolicyIdentity;
    readSourceSnapshot(
        path: string,
        signal?: AbortSignal,
    ): Promise<PageletAgentSourceSnapshot | null>;
    isPathAllowed(path: string): boolean;
    now?: number;
    signal?: AbortSignal;
}

interface CacheEntry {
    insight: PageletAgentVerifiedInsight;
    expiresAt?: number;
}

export class PageletAgentCache {
    private readonly entries = new Map<string, CacheEntry>();

    put(insight: PageletAgentVerifiedInsight): void {
        if (!insight.body.trim() || insight.body.trim() === PAGELET_NO_INSIGHT) return;
        const expiresAt = insight.webObservations.length > 0
            ? insight.preparedAt + PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS
            : undefined;
        this.entries.set(insight.anchor.path, {
            insight: cloneInsight(insight),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
        });
    }

    async getValid(
        options: PageletAgentCacheReadOptions,
    ): Promise<PageletAgentVerifiedInsight | null> {
        const entry = this.entries.get(options.anchor.path);
        if (!entry) return null;
        const now = options.now ?? Date.now();
        if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
            this.entries.delete(options.anchor.path);
            return null;
        }
        const identity = entry.insight.cacheIdentity;
        if (
            identity.pipelineVersion !== PAGELET_DEEP_DISCOVER_PIPELINE_VERSION
            || !sameSourceSnapshot(identity.anchor, anchorSnapshotIdentity(options.anchor))
            || !samePolicyIdentity(identity, options.policyIdentity)
        ) {
            this.entries.delete(options.anchor.path);
            return null;
        }

        for (const source of identity.sources) {
            if (!safePathAllowed(options.isPathAllowed, source.path)) {
                this.entries.delete(options.anchor.path);
                return null;
            }
            const current = await options.readSourceSnapshot(source.path, options.signal);
            if (!current || !sameSourceSnapshot(source, current)) {
                this.entries.delete(options.anchor.path);
                return null;
            }
        }
        return cloneInsight(entry.insight);
    }

    hasEquivalent(
        anchorPath: string,
        normalizedBody: string,
        sources: readonly PageletAgentSourceSnapshot[],
    ): boolean {
        const entry = this.entries.get(anchorPath);
        if (!entry || entry.insight.normalizedBody !== normalizedBody) return false;
        return sourceIdentityList(entry.insight.cacheIdentity.sources) === sourceIdentityList(sources);
    }

    deleteAnchor(path: string): void {
        this.entries.delete(path);
    }

    clear(): void {
        this.entries.clear();
    }
}

export function createPageletAgentCacheIdentity(input: {
    anchor: PageletAnchorSnapshot;
    sources: readonly PageletAgentSourceSnapshot[];
    policyIdentity: PageletAgentPolicyIdentity;
}): PageletAgentCacheIdentity {
    return {
        pipelineVersion: PAGELET_DEEP_DISCOVER_PIPELINE_VERSION,
        anchor: anchorSnapshotIdentity(input.anchor),
        sources: dedupeAndSortSources(input.sources),
        dataBoundaryIdentity: input.policyIdentity.dataBoundaryIdentity,
        providerPolicyIdentity: input.policyIdentity.providerPolicyIdentity,
        modelIdentity: input.policyIdentity.modelIdentity,
        locale: normalizeLocale(input.policyIdentity.locale),
    };
}

export function hashPageletAgentCacheIdentity(identity: PageletAgentCacheIdentity): string {
    const canonical = stableStringify(identity);
    return [
        "left",
        "middle-left",
        "middle-right",
        "right",
    ].map((salt) => stableHash(`pagelet-agent-cache\u0000${salt}\u0000${canonical}`)).join("");
}

export function normalizePageletInsightBody(body: string): string {
    return body
        .normalize("NFKC")
        .replace(/\r\n?/g, "\n")
        .trim()
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n");
}

function samePolicyIdentity(
    identity: PageletAgentCacheIdentity,
    current: PageletAgentPolicyIdentity,
): boolean {
    return identity.dataBoundaryIdentity === current.dataBoundaryIdentity
        && identity.providerPolicyIdentity === current.providerPolicyIdentity
        && identity.modelIdentity === current.modelIdentity
        && identity.locale === normalizeLocale(current.locale);
}

function dedupeAndSortSources(
    sources: readonly PageletAgentSourceSnapshot[],
): PageletAgentSourceSnapshot[] {
    const byPath = new Map<string, PageletAgentSourceSnapshot>();
    for (const source of sources) byPath.set(source.path, { ...source });
    return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function sourceIdentityList(sources: readonly PageletAgentSourceSnapshot[]): string {
    return dedupeAndSortSources(sources)
        .map((source) => `${source.path}\u0000${source.mtime}\u0000${source.size}\u0000${source.contentHash}`)
        .join("\u0001");
}

function normalizeLocale(locale: string): string {
    return locale.normalize("NFKC").trim().toLowerCase();
}

function safePathAllowed(predicate: (path: string) => boolean, path: string): boolean {
    try {
        return predicate(path) === true;
    } catch {
        return false;
    }
}

function cloneInsight(insight: PageletAgentVerifiedInsight): PageletAgentVerifiedInsight {
    return {
        ...insight,
        anchor: { ...insight.anchor },
        sources: insight.sources.map((source) => ({ ...source })),
        sourceRefs: insight.sourceRefs.map((source) => ({ ...source })),
        cacheIdentity: {
            ...insight.cacheIdentity,
            anchor: { ...insight.cacheIdentity.anchor },
            sources: insight.cacheIdentity.sources.map((source) => ({ ...source })),
        },
        metrics: {
            ...insight.metrics,
            tokenUsage: insight.metrics.tokenUsage
                ? { ...insight.metrics.tokenUsage }
                : undefined,
        },
        webObservations: insight.webObservations.map((observation) => ({ ...observation })),
    };
}
