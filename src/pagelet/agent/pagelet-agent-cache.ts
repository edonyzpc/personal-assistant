import { stableStringify } from "../../ai-services/agent-utils";
import { isAbortError, throwIfAborted } from "../../ai-services/chat-utils";
import { stableHash } from "../../pa/helpers";
import {
    anchorSnapshotIdentity,
    sameSourceSnapshot,
} from "./anchor-snapshot";
import {
    isPageletNoInsightTerminal,
    PAGELET_DEEP_DISCOVER_PIPELINE_VERSION,
    PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS,
    type PageletAgentCacheIdentity,
    type PageletAgentPolicyIdentity,
    type PageletAgentSourceSnapshot,
    type PageletAgentVerifiedInsight,
    type PageletAgentVerifiedInsightCollection,
    type PageletAnchorSnapshot,
    type PageletAnchorSnapshotIdentity,
} from "./types";

export interface PageletAgentCacheReadOptions {
    anchor: PageletAnchorSnapshot;
    policyIdentity: PageletAgentPolicyIdentity;
    readSourceSnapshot(
        path: string,
        signal?: AbortSignal,
    ): Promise<PageletAgentSourceSnapshot | null>;
    isPathAllowed(path: string): boolean;
    getEvidenceEpoch?(): string;
    now?: number;
    signal?: AbortSignal;
}

interface CacheEntry {
    collection: PageletAgentVerifiedInsightCollection;
    expiresAt?: number;
}

/** Content-free cache state used only to prove run-local mutation behavior. */
export interface PageletAgentCacheMutationSnapshot {
    readonly version: number;
    readonly entryCount: number;
}

export class PageletAgentCache {
    private readonly entries = new Map<string, CacheEntry>();
    private mutationVersion = 0;

    getMutationSnapshot(): PageletAgentCacheMutationSnapshot {
        return Object.freeze({
            version: this.mutationVersion,
            entryCount: this.entries.size,
        });
    }

    put(insight: PageletAgentVerifiedInsight): void {
        this.putCollection({
            collectionId: insight.collectionId,
            anchor: { ...insight.anchor },
            insights: [insight],
            preparedAt: insight.preparedAt,
        });
    }

    putCollection(collection: PageletAgentVerifiedInsightCollection): void {
        if (!isValidCollectionShape(collection)) return;
        const validInsights = collection.insights.filter(isPageletVerifiedInsightIdentityValid);
        if (validInsights.length === 0) return;
        const currentCollection = validInsights.length === collection.insights.length
            ? collection
            : regroupCollection(collection, validInsights);
        const expiresAt = currentCollection.insights.some((insight) => insight.webObservations.length > 0)
            ? currentCollection.preparedAt + PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS
            : undefined;
        this.entries.set(currentCollection.anchor.path, {
            collection: cloneCollection(currentCollection),
            ...(expiresAt !== undefined ? { expiresAt } : {}),
        });
        this.mutationVersion += 1;
    }

    async getValidCollection(
        options: PageletAgentCacheReadOptions,
    ): Promise<PageletAgentVerifiedInsightCollection | null> {
        const entry = this.entries.get(options.anchor.path);
        if (!entry) return null;
        const now = options.now ?? Date.now();
        if (
            !sameSourceSnapshot(entry.collection.anchor, anchorSnapshotIdentity(options.anchor))
            || !isValidCollectionShape(entry.collection)
        ) {
            this.deleteEntry(options.anchor.path);
            return null;
        }

        const attempts = options.getEvidenceEpoch ? 2 : 1;
        let validInsights: PageletAgentVerifiedInsight[] | null = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            throwIfAborted(options.signal);
            const epochBefore = readEvidenceEpoch(options.getEvidenceEpoch);
            if (!epochBefore.ok) continue;
            const currentInsights: PageletAgentVerifiedInsight[] = [];
            for (const insight of entry.collection.insights) {
                const identity = insight.cacheIdentity;
                if (
                    (insight.webObservations.length > 0
                        && now >= insight.preparedAt + PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS)
                    || hashPageletAgentCacheIdentity(identity) !== insight.cacheIdentityHash
                    || !isPageletVerifiedInsightIdentityValid(insight)
                    || identity.pipelineVersion !== PAGELET_DEEP_DISCOVER_PIPELINE_VERSION
                    || !sameSourceSnapshot(identity.anchor, anchorSnapshotIdentity(options.anchor))
                    || !samePolicyIdentity(identity, options.policyIdentity)
                    || insight.collectionId !== entry.collection.collectionId
                    || sourceIdentityList(identity.sources) !== sourceIdentityList(insight.sources)
                    || createPageletInsightId({
                        anchor: insight.anchor,
                        normalizedBody: insight.normalizedBody,
                        normalizedClaim: insight.normalizedClaim,
                        sources: insight.sources,
                    }) !== insight.insightId
                ) {
                    continue;
                }
                let current = true;
                const expectedByPath = new Map<string, PageletAgentSourceSnapshot>();
                for (const source of identity.sources) expectedByPath.set(source.path, source);
                expectedByPath.set(identity.anchor.path, identity.anchor);
                for (const source of expectedByPath.values()) {
                    try {
                        throwIfAborted(options.signal);
                        if (!safePathAllowed(options.isPathAllowed, source.path)) {
                            current = false;
                            break;
                        }
                        const snapshot = await options.readSourceSnapshot(source.path, options.signal);
                        throwIfAborted(options.signal);
                        if (
                            !safePathAllowed(options.isPathAllowed, source.path)
                            || !snapshot
                            || !sameSourceSnapshot(source, snapshot)
                        ) {
                            current = false;
                            break;
                        }
                    } catch (error) {
                        if (isAbortError(error, options.signal)) throw error;
                        current = false;
                        break;
                    }
                }
                if (current) currentInsights.push(insight);
            }
            const epochAfter = readEvidenceEpoch(options.getEvidenceEpoch);
            if (epochAfter.ok && epochAfter.value === epochBefore.value) {
                validInsights = currentInsights;
                break;
            }
        }
        if (!validInsights) return null;
        if (validInsights.length === 0) {
            this.deleteEntry(options.anchor.path);
            return null;
        }
        if (validInsights.length !== entry.collection.insights.length) {
            const regrouped = regroupCollection(entry.collection, validInsights);
            this.putCollection(regrouped);
            return cloneCollection(regrouped);
        }
        return cloneCollection(entry.collection);
    }

    async getValid(
        options: PageletAgentCacheReadOptions,
    ): Promise<PageletAgentVerifiedInsight | null> {
        return (await this.getValidCollection(options))?.insights[0] ?? null;
    }

    hasEquivalent(
        anchorPath: string,
        normalizedBody: string,
        sources: readonly PageletAgentSourceSnapshot[],
    ): boolean {
        const entry = this.entries.get(anchorPath);
        if (!entry) return false;
        const sourceIdentity = sourceIdentityList(sources);
        return entry.collection.insights.some((insight) => (
            insight.normalizedBody === normalizedBody
            && sourceIdentityList(insight.cacheIdentity.sources) === sourceIdentity
        ));
    }

    deleteAnchor(path: string): void {
        this.deleteEntry(path);
    }

    clear(): void {
        if (this.entries.size === 0) return;
        this.entries.clear();
        this.mutationVersion += 1;
    }

    private deleteEntry(path: string): void {
        if (this.entries.delete(path)) this.mutationVersion += 1;
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

export function normalizePageletInsightClaim(body: string): string {
    return normalizePageletInsightBody(body)
        .replace(/`[^`\n]*\.md`/giu, " [source] ")
        .replace(/!?\[([^\]\n]*)\]\([^\n)]+\.md(?:#[^\n)]*)?\)/giu, "$1 [source]")
        .replace(/!?\[\[([^\]\n|#]+)(?:#[^\]\n|]+)?(?:\|([^\]\n]+))?\]\]/gu, (_match, target, alias) => (
            `${alias || target ? "[source]" : ""}`
        ))
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/[*_~>]/g, " ")
        .replace(/[\p{P}\p{S}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

export function createPageletInsightId(input: {
    anchor: PageletAnchorSnapshotIdentity;
    normalizedBody: string;
    normalizedClaim: string;
    sources: readonly PageletAgentSourceSnapshot[];
}): string {
    const canonical = stableStringify({
        pipelineVersion: PAGELET_DEEP_DISCOVER_PIPELINE_VERSION,
        anchor: input.anchor,
        bodyHash: hashStableValue("body", input.normalizedBody),
        claimHash: hashStableValue("claim", input.normalizedClaim),
        sources: dedupeAndSortSources(input.sources),
    });
    return `pagelet-insight:${hashStableValue("insight", canonical)}`;
}

export function createPageletInsightCollectionId(insightIds: readonly string[]): string {
    return `pagelet-collection:${hashStableValue("collection", stableStringify([...insightIds]))}`;
}

export function hashPageletInsightBody(normalizedBody: string): string {
    return hashStableValue("body", normalizedBody);
}

export function hashPageletInsightClaim(normalizedClaim: string): string {
    return hashStableValue("claim", normalizedClaim);
}

export function isPageletVerifiedInsightIdentityValid(
    insight: PageletAgentVerifiedInsight,
): boolean {
    if (!insight.body.trim() || isPageletNoInsightTerminal(insight.body)) return false;
    if (normalizePageletInsightBody(insight.body) !== insight.normalizedBody) return false;
    if (normalizePageletInsightClaim(insight.body) !== insight.normalizedClaim) return false;
    if (hashPageletInsightBody(insight.normalizedBody) !== insight.bodyHash) return false;
    if (hashPageletInsightClaim(insight.normalizedClaim) !== insight.claimHash) return false;
    if (hashPageletAgentCacheIdentity(insight.cacheIdentity) !== insight.cacheIdentityHash) return false;
    if (!sameSourceSnapshot(insight.anchor, insight.cacheIdentity.anchor)) return false;
    const anchorSource = insight.sources.find((source) => source.path === insight.anchor.path);
    if (!anchorSource || !sameSourceSnapshot(anchorSource, insight.anchor)) return false;
    if (sourceIdentityList(insight.sources) !== sourceIdentityList(insight.cacheIdentity.sources)) {
        return false;
    }
    return createPageletInsightId({
        anchor: insight.anchor,
        normalizedBody: insight.normalizedBody,
        normalizedClaim: insight.normalizedClaim,
        sources: insight.sources,
    }) === insight.insightId;
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
    return [...byPath.values()].sort((left, right) => compareCodePoint(left.path, right.path));
}

function sourceIdentityList(sources: readonly PageletAgentSourceSnapshot[]): string {
    return dedupeAndSortSources(sources)
        .map((source) => `${source.path}\u0000${source.mtime}\u0000${source.size}\u0000${source.contentHash}`)
        .join("\u0001");
}

function hashStableValue(namespace: string, value: string): string {
    return [
        "left",
        "middle-left",
        "middle-right",
        "right",
    ].map((salt) => stableHash(`pagelet-${namespace}\u0000${salt}\u0000${value}`)).join("");
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

function readEvidenceEpoch(getEpoch: (() => string) | undefined):
| { ok: true; value: string | undefined }
| { ok: false } {
    if (!getEpoch) return { ok: true, value: undefined };
    try {
        const value = getEpoch();
        return value ? { ok: true, value } : { ok: false };
    } catch {
        return { ok: false };
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

function cloneCollection(
    collection: PageletAgentVerifiedInsightCollection,
): PageletAgentVerifiedInsightCollection {
    return {
        collectionId: collection.collectionId,
        anchor: { ...collection.anchor },
        insights: collection.insights.map(cloneInsight),
        preparedAt: collection.preparedAt,
    };
}

function regroupCollection(
    collection: PageletAgentVerifiedInsightCollection,
    insights: readonly PageletAgentVerifiedInsight[],
): PageletAgentVerifiedInsightCollection {
    const collectionId = createPageletInsightCollectionId(
        insights.map((insight) => insight.insightId),
    );
    return {
        collectionId,
        anchor: { ...collection.anchor },
        insights: insights.map((insight) => ({ ...cloneInsight(insight), collectionId })),
        preparedAt: collection.preparedAt,
    };
}

function isValidCollectionShape(collection: PageletAgentVerifiedInsightCollection): boolean {
    if (collection.insights.length < 1 || collection.insights.length > 2) return false;
    if (new Set(collection.insights.map((insight) => insight.insightId)).size !== collection.insights.length) {
        return false;
    }
    if (
        collection.collectionId !== createPageletInsightCollectionId(
            collection.insights.map((insight) => insight.insightId),
        )
    ) return false;
    return collection.insights.every((insight) => (
        insight.body.trim().length > 0
        && !isPageletNoInsightTerminal(insight.body)
        && insight.collectionId === collection.collectionId
        && sameSourceSnapshot(insight.anchor, collection.anchor)
    ));
}

function compareCodePoint(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
