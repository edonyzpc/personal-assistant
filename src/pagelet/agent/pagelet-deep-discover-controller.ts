import { isAbortError } from "../../ai-services/chat-utils";
import {
    anchorSnapshotIdentity,
    sameSourceSnapshot,
    sourceSnapshotIdentity,
} from "./anchor-snapshot";
import {
    PageletAgentCache,
    createPageletAgentCacheIdentity,
    createPageletInsightCollectionId,
    createPageletInsightId,
    hashPageletInsightBody,
    hashPageletInsightClaim,
    hashPageletAgentCacheIdentity,
    normalizePageletInsightClaim,
    type PageletAgentCacheMutationSnapshot,
} from "./pagelet-agent-cache";
import {
    arePageletAgentInsightsDistinct,
    evaluatePageletAgentQuality,
    resolvePageletInsightSourcePaths,
} from "./pagelet-agent-quality-gate";
import {
    isPageletNoInsightTerminal,
    PAGELET_DEEP_DISCOVER_PIPELINE_VERSION,
    PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS,
} from "./types";
import type {
    PageletAgentPolicyIdentity,
    PageletAgentQualityRejectReason,
    PageletAgentRuntime,
    PageletAgentSourceMaterial,
    PageletAgentSourceSnapshot,
    PageletAgentValidationIdentity,
    PageletAgentVerifiedInsight,
    PageletAgentVerifiedInsightCollection,
    PageletAnchorSnapshot,
    PageletDeepDiscoverControllerResult,
    PageletDeepDiscoverTriggerReason,
} from "./types";

export interface PageletDeepDiscoverControllerRequest {
    path: string;
    triggerReason: PageletDeepDiscoverTriggerReason;
    anchorSnapshot?: PageletAnchorSnapshot;
    force?: boolean;
    signal?: AbortSignal;
}

export interface PageletDeepDiscoverControllerRunIdentity {
    readonly schemaVersion: 1;
    /** Controller-owned identity also passed into the canonical Agent runtime. */
    readonly runId: string;
    /** Monotonic within one controller lifecycle. */
    readonly sequence: number;
    readonly anchorPath: string;
    readonly triggerReason: PageletDeepDiscoverTriggerReason;
    readonly force: boolean;
    readonly cacheBefore: PageletAgentCacheMutationSnapshot;
}

export interface PageletDeepDiscoverControllerRunCompletion
    extends PageletDeepDiscoverControllerRunIdentity {
    readonly resultId: string;
    readonly cacheAfter: PageletAgentCacheMutationSnapshot;
}

export interface PageletDeepDiscoverControllerDependencies {
    runtime: PageletAgentRuntime;
    captureSnapshot(path: string, signal?: AbortSignal): Promise<PageletAnchorSnapshot | null>;
    captureSourceMaterial(path: string, signal?: AbortSignal): Promise<PageletAgentSourceMaterial | null>;
    getPolicyIdentity(): PageletAgentPolicyIdentity | PromiseLike<PageletAgentPolicyIdentity>;
    /** Host-owned content/privacy epoch used to seal grouped latest-source reads. */
    getEvidenceEpoch?(): string;
    isPathAllowed(path: string): boolean;
    admitRun?(input: {
        path: string;
        triggerReason: PageletDeepDiscoverTriggerReason;
        force: boolean;
        signal?: AbortSignal;
    }): Promise<{ ok: true } | { ok: false; reason: "limit" | "unavailable" }>;
    getAnchorRelations?(anchorPath: string): {
        explicitLinks?: readonly string[];
        backlinks?: readonly string[];
    };
    isSeen?(input: {
        anchor: PageletAnchorSnapshot;
        body: string;
        normalizedBody: string;
        sources: readonly PageletAgentSourceSnapshot[];
        triggerReason: PageletDeepDiscoverTriggerReason;
    }): boolean;
    cache?: PageletAgentCache;
    now?: () => number;
    /** Tests may make the otherwise opaque controller-owned identity deterministic. */
    createRunId?: () => string;
    onRunStart?: (
        run: PageletDeepDiscoverControllerRunIdentity,
        request: PageletDeepDiscoverControllerRequest,
    ) => void;
    onResult?: (
        result: PageletDeepDiscoverControllerResult,
        request: PageletDeepDiscoverControllerRequest,
    ) => void;
    onRunComplete?: (
        result: PageletDeepDiscoverControllerResult,
        request: PageletDeepDiscoverControllerRequest,
        run: PageletDeepDiscoverControllerRunCompletion,
    ) => void;
}

interface ActiveRun {
    path: string;
    force: boolean;
    controller: AbortController;
    promise: Promise<PageletDeepDiscoverControllerResult>;
}

export class PageletDeepDiscoverController {
    private readonly cache: PageletAgentCache;
    private active?: ActiveRun;
    private disposed = false;
    private nextRunSequence = 0;

    constructor(private readonly dependencies: PageletDeepDiscoverControllerDependencies) {
        this.cache = dependencies.cache ?? new PageletAgentCache();
    }

    run(
        request: PageletDeepDiscoverControllerRequest,
    ): Promise<PageletDeepDiscoverControllerResult> {
        if (this.disposed) {
            return Promise.resolve({ status: "error", reason: "controller-disposed" });
        }
        if (this.active && this.active.path === request.path && !request.force) {
            return this.active.promise;
        }

        this.active?.controller.abort();
        const controller = new AbortController();
        const combined = combineAbortSignals(controller.signal, request.signal);
        const normalizedRequest = { ...request, force: request.force === true };
        const sequence = this.nextRunSequence >= Number.MAX_SAFE_INTEGER
            ? 1
            : this.nextRunSequence + 1;
        this.nextRunSequence = sequence;
        const runId = this.dependencies.createRunId?.() ?? createControllerRunId(sequence);
        const runIdentity: PageletDeepDiscoverControllerRunIdentity = Object.freeze({
            schemaVersion: 1,
            runId,
            sequence,
            anchorPath: normalizedRequest.path,
            triggerReason: normalizedRequest.triggerReason,
            force: normalizedRequest.force,
            cacheBefore: this.cache.getMutationSnapshot(),
        });
        safelyNotify(() => this.dependencies.onRunStart?.(runIdentity, normalizedRequest));
        const promise = this.execute(normalizedRequest, combined.signal, runId)
            .catch((error): PageletDeepDiscoverControllerResult => {
                if (isAbortError(error, combined.signal)) {
                    return { status: "quiet", reason: "aborted" };
                }
                return { status: "error", reason: "deep-discover-failed" };
            })
            .then((result) => {
                const completion: PageletDeepDiscoverControllerRunCompletion = Object.freeze({
                    ...runIdentity,
                    resultId: `${runId}:result`,
                    cacheAfter: this.cache.getMutationSnapshot(),
                });
                safelyNotify(() => this.dependencies.onRunComplete?.(
                    result,
                    normalizedRequest,
                    completion,
                ));
                safelyNotify(() => this.dependencies.onResult?.(result, normalizedRequest));
                return result;
            })
            .finally(() => {
                combined.dispose();
                if (this.active?.controller === controller) this.active = undefined;
            });
        this.active = {
            path: request.path,
            force: request.force === true,
            controller,
            promise,
        };
        return promise;
    }

    cancel(): void {
        this.active?.controller.abort();
        this.active = undefined;
    }

    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Revalidate a delivered insight without invoking the model or refreshing
     * the cache. Pagelet actions and Chat handoff fail closed when any source,
     * policy, pipeline, or web-backed reuse boundary changed.
     */
    async validateInsight(
        identity: PageletAgentValidationIdentity,
        signal?: AbortSignal,
    ): Promise<boolean> {
        try {
            if (this.disposed || signal?.aborted) return false;
            const expected = identity.cacheIdentity;
            if (
                expected.pipelineVersion !== PAGELET_DEEP_DISCOVER_PIPELINE_VERSION
                || hashPageletAgentCacheIdentity(expected) !== identity.cacheIdentityHash
                || createPageletInsightId({
                    anchor: expected.anchor,
                    normalizedBody: identity.normalizedBody,
                    normalizedClaim: identity.normalizedClaim,
                    sources: expected.sources,
                }) !== identity.insightId
            ) return false;
            if (
                identity.webObservations.length > 0
                && (this.dependencies.now ?? Date.now)() - identity.preparedAt
                    >= PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS
            ) return false;

            const snapshots = new Map<string, PageletAgentSourceSnapshot>();
            for (const source of expected.sources) snapshots.set(source.path, source);
            snapshots.set(expected.anchor.path, expected.anchor);
            const attempts = this.dependencies.getEvidenceEpoch ? 2 : 1;
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                throwIfAborted(signal);
                const epochBefore = this.readEvidenceEpoch();
                if (!epochBefore.ok) continue;
                const policyBefore = await this.dependencies.getPolicyIdentity();
                if (!samePolicyIdentity(expected, policyBefore)) return false;

                let current = true;
                for (const snapshot of snapshots.values()) {
                    throwIfAborted(signal);
                    if (!safeAllowed(this.dependencies.isPathAllowed, snapshot.path)) {
                        current = false;
                        break;
                    }
                    const material = await this.dependencies.captureSourceMaterial(snapshot.path, signal);
                    throwIfAborted(signal);
                    if (
                        !material
                        || !safeAllowed(this.dependencies.isPathAllowed, snapshot.path)
                        || !sameSourceSnapshot(snapshot, material)
                    ) {
                        current = false;
                        break;
                    }
                }

                const policyAfter = await this.dependencies.getPolicyIdentity();
                const epochAfter = this.readEvidenceEpoch();
                if (
                    !epochAfter.ok
                    || epochAfter.value !== epochBefore.value
                ) continue;
                return current && samePolicyIdentity(expected, policyAfter);
            }
            return false;
        } catch {
            return false;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.cancel();
        this.cache.clear();
    }

    private async execute(
        request: PageletDeepDiscoverControllerRequest & { force: boolean },
        signal: AbortSignal,
        runId: string,
    ): Promise<PageletDeepDiscoverControllerResult> {
        throwIfAborted(signal);
        if (!safeAllowed(this.dependencies.isPathAllowed, request.path)) {
            return { status: "denied", reason: "data-boundary" };
        }
        const anchor = request.anchorSnapshot?.path === request.path
            ? request.anchorSnapshot
            : await this.dependencies.captureSnapshot(request.path, signal);
        if (!anchor) return { status: "stale", reason: "anchor-snapshot-unavailable" };
        throwIfAborted(signal);
        const policyIdentity = await this.dependencies.getPolicyIdentity();
        if (!request.force) {
            const cached = await this.cache.getValidCollection({
                anchor,
                policyIdentity,
                isPathAllowed: this.dependencies.isPathAllowed,
                readSourceSnapshot: async (path, readSignal) => {
                    const material = await this.dependencies.captureSourceMaterial(path, readSignal);
                    return material ? sourceSnapshotIdentity(material) : null;
                },
                now: (this.dependencies.now ?? Date.now)(),
                signal,
                getEvidenceEpoch: this.dependencies.getEvidenceEpoch,
            });
            if (cached) {
                const policyAfterCacheRead = await this.dependencies.getPolicyIdentity();
                if (samePolicyIdentity(policyIdentity, policyAfterCacheRead)) {
                    return {
                        status: "cache-hit",
                        insight: cached.insights[0],
                        insights: cached.insights,
                        collection: cached,
                    };
                }
                this.cache.deleteAnchor(anchor.path);
                return { status: "stale", reason: "policy-identity-changed" };
            }
        }

        const admission = await this.dependencies.admitRun?.({
            path: anchor.path,
            triggerReason: request.triggerReason,
            force: request.force,
            signal,
        }) ?? { ok: true as const };
        if (!admission.ok) return { status: "limit", reason: admission.reason };
        throwIfAborted(signal);

        const run = await this.dependencies.runtime.run({
            anchor,
            triggerReason: request.triggerReason,
            runId,
            signal,
        });
        throwIfAborted(signal);
        if (run.loopResult.status === "aborted") {
            return { status: "quiet", reason: "aborted", metrics: run.metrics };
        }
        const candidateDrafts = run.insightDrafts ?? (
            run.finalText && !isPageletNoInsightTerminal(run.finalText)
                ? [{ body: run.finalText, origin: "terminal" as const, declaredSourceIds: [] }]
                : []
        );
        const boundedDrafts = candidateDrafts.slice(0, 2);
        const rejectedNoInsightDraft = boundedDrafts.some((draft) => (
            isPageletNoInsightTerminal(draft.body)
        ));
        const drafts = boundedDrafts.filter((draft) => (
            !isPageletNoInsightTerminal(draft.body)
        ));
        if (drafts.length === 0) {
            return {
                status: "quiet",
                reason: isPageletNoInsightTerminal(run.finalText) || rejectedNoInsightDraft
                    ? "no-insight"
                    : "runtime-incomplete",
                metrics: run.metrics,
            };
        }

        const currentPolicyIdentity = await this.dependencies.getPolicyIdentity();
        if (!samePolicyIdentity(policyIdentity, currentPolicyIdentity)) {
            return { status: "stale", reason: "policy-identity-changed" };
        }

        const proactiveDelivery = request.triggerReason !== "explicit" && !request.force;
        const acceptedQualities: Array<Extract<
            Awaited<ReturnType<typeof evaluatePageletAgentQuality>>,
            { accepted: true }
        >> = [];
        let firstRejectReason: PageletAgentQualityRejectReason | undefined;
        for (const draft of drafts) {
            try {
                const resolvedSources = resolvePageletInsightSourcePaths(
                    draft.body,
                    run.sourceSnapshots.map((snapshot) => snapshot.path),
                );
                const draftSourceSnapshots = run.sourceSnapshots.filter((snapshot) => (
                    resolvedSources.paths.includes(snapshot.path)
                ));
                const sourceMaterials = resolvedSources.hasUngroundedPath
                    ? new Map<string, PageletAgentSourceMaterial>()
                    : await this.captureRunSourceMaterials(
                        draftSourceSnapshots,
                        signal,
                    );
                if (!sourceMaterials) {
                    firstRejectReason ??= "stale-source";
                    continue;
                }
                const quality = await evaluatePageletAgentQuality({
                    run: resolvedSources.hasUngroundedPath
                        ? run
                        : { ...run, sourceSnapshots: draftSourceSnapshots },
                    body: draft.body,
                    sourceMaterials,
                    readCurrentSourceSnapshot: async (path, readSignal) => {
                        const material = await this.dependencies.captureSourceMaterial(path, readSignal);
                        return material ? sourceSnapshotIdentity(material) : null;
                    },
                    isPathAllowed: this.dependencies.isPathAllowed,
                    anchorRelations: this.dependencies.getAnchorRelations?.(anchor.path),
                    isDuplicate: proactiveDelivery
                        ? (normalizedBody, sources) => this.cache.hasEquivalent(
                            anchor.path,
                            normalizedBody,
                            sources,
                        )
                        : undefined,
                    isSeen: proactiveDelivery && this.dependencies.isSeen
                        ? (body, normalizedBody, sources) => this.dependencies.isSeen!({
                            anchor,
                            body,
                            normalizedBody,
                            sources,
                            triggerReason: request.triggerReason,
                        })
                        : undefined,
                    signal,
                });
                if (!quality.accepted) {
                    firstRejectReason ??= quality.reason;
                    continue;
                }
                if (
                    acceptedQualities.length > 0
                    && !arePageletAgentInsightsDistinct(acceptedQualities[0], quality)
                ) continue;
                acceptedQualities.push(quality);
            } catch (error) {
                if (isAbortError(error, signal)) throw error;
                firstRejectReason ??= "stale-source";
            }
        }
        if (acceptedQualities.length === 0) {
            return {
                status: "quiet",
                reason: firstRejectReason ?? "no-insight",
                metrics: run.metrics,
            };
        }
        const commitQualities = await this.filterCurrentQualitiesAtStableEpoch(
            anchor,
            acceptedQualities,
            signal,
        );
        if (!commitQualities) {
            return { status: "stale", reason: "evidence-epoch-changed" };
        }
        if (commitQualities.length === 0) {
            return {
                status: "quiet",
                reason: firstRejectReason ?? "stale-source",
                metrics: run.metrics,
            };
        }
        throwIfAborted(signal);
        const policyAfterCommitReads = await this.dependencies.getPolicyIdentity();
        if (!samePolicyIdentity(policyIdentity, policyAfterCommitReads)) {
            return { status: "stale", reason: "policy-identity-changed" };
        }

        const preparedAt = (this.dependencies.now ?? Date.now)();
        const anchorIdentity = anchorSnapshotIdentity(anchor);
        const identityInputs = commitQualities.map((quality) => {
            const normalizedClaim = normalizePageletInsightClaim(quality.body);
            return {
                quality,
                normalizedClaim,
                insightId: createPageletInsightId({
                    anchor: anchorIdentity,
                    normalizedBody: quality.normalizedBody,
                    normalizedClaim,
                    sources: quality.sources,
                }),
            };
        });
        const collectionId = createPageletInsightCollectionId(
            identityInputs.map((input) => input.insightId),
        );
        const insights: PageletAgentVerifiedInsight[] = identityInputs.map((input) => {
            const cacheIdentity = createPageletAgentCacheIdentity({
                anchor,
                sources: input.quality.sources,
                policyIdentity,
            });
            return {
                insightId: input.insightId,
                collectionId,
                body: input.quality.body,
                normalizedBody: input.quality.normalizedBody,
                normalizedClaim: input.normalizedClaim,
                bodyHash: hashPageletInsightBody(input.quality.normalizedBody),
                claimHash: hashPageletInsightClaim(input.normalizedClaim),
                anchor: anchorIdentity,
                sources: input.quality.sources,
                sourceRefs: input.quality.sourceRefs,
                cacheIdentity,
                cacheIdentityHash: hashPageletAgentCacheIdentity(cacheIdentity),
                triggerReason: request.triggerReason,
                preparedAt,
                metrics: run.metrics,
                webObservations: run.webObservations,
            };
        });
        const collection: PageletAgentVerifiedInsightCollection = {
            collectionId,
            anchor: anchorIdentity,
            insights,
            preparedAt,
        };
        this.cache.putCollection(collection);
        return {
            status: "verified",
            insight: insights[0],
            insights,
            collection,
        };
    }

    private async captureRunSourceMaterials(
        snapshots: readonly PageletAgentSourceSnapshot[],
        signal: AbortSignal,
    ): Promise<Map<string, PageletAgentSourceMaterial> | null> {
        const materials = new Map<string, PageletAgentSourceMaterial>();
        for (const snapshot of snapshots) {
            throwIfAborted(signal);
            const material = await this.dependencies.captureSourceMaterial(snapshot.path, signal);
            if (!material || !sameSourceSnapshot(snapshot, material)) return null;
            materials.set(snapshot.path, material);
        }
        return materials;
    }

    /**
     * The quality gate is intentionally not the commit point: a source may
     * change or leave the provider boundary while another draft is being
     * checked. Re-read every source for every accepted insight immediately
     * before it enters cache/delivery state so one stale sibling cannot poison
     * an otherwise-current insight.
     */
    private async isQualityCurrentAtCommit(
        anchor: PageletAnchorSnapshot,
        sources: readonly PageletAgentSourceSnapshot[],
        signal: AbortSignal,
    ): Promise<boolean> {
        const anchorIdentity = anchorSnapshotIdentity(anchor);
        const citedAnchor = sources.find((source) => source.path === anchor.path);
        if (!citedAnchor || !sameSourceSnapshot(citedAnchor, anchorIdentity)) return false;
        const expectedByPath = new Map<string, PageletAgentSourceSnapshot>();
        for (const source of sources) expectedByPath.set(source.path, source);
        expectedByPath.set(anchor.path, anchorIdentity);

        for (const expected of expectedByPath.values()) {
            throwIfAborted(signal);
            if (!safeAllowed(this.dependencies.isPathAllowed, expected.path)) return false;
            const current = await this.dependencies.captureSourceMaterial(expected.path, signal);
            throwIfAborted(signal);
            if (
                !current
                || !safeAllowed(this.dependencies.isPathAllowed, expected.path)
                || !sameSourceSnapshot(expected, current)
            ) return false;
        }
        return true;
    }

    private async filterCurrentQualitiesAtStableEpoch<T extends {
        sources: readonly PageletAgentSourceSnapshot[];
    }>(
        anchor: PageletAnchorSnapshot,
        qualities: readonly T[],
        signal: AbortSignal,
    ): Promise<T[] | null> {
        const attempts = this.dependencies.getEvidenceEpoch ? 2 : 1;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            throwIfAborted(signal);
            const epochBefore = this.readEvidenceEpoch();
            if (!epochBefore.ok) continue;
            const current: T[] = [];
            for (const quality of qualities) {
                try {
                    if (await this.isQualityCurrentAtCommit(anchor, quality.sources, signal)) {
                        current.push(quality);
                    }
                } catch (error) {
                    if (isAbortError(error, signal)) throw error;
                }
            }
            const epochAfter = this.readEvidenceEpoch();
            if (epochAfter.ok && epochAfter.value === epochBefore.value) return current;
        }
        return null;
    }

    private readEvidenceEpoch():
    | { ok: true; value: string | undefined }
    | { ok: false } {
        const getEpoch = this.dependencies.getEvidenceEpoch;
        if (!getEpoch) return { ok: true, value: undefined };
        try {
            const value = getEpoch();
            return value ? { ok: true, value } : { ok: false };
        } catch {
            return { ok: false };
        }
    }
}

function samePolicyIdentity(
    left: PageletAgentPolicyIdentity,
    right: PageletAgentPolicyIdentity,
): boolean {
    return left.dataBoundaryIdentity === right.dataBoundaryIdentity
        && left.providerPolicyIdentity === right.providerPolicyIdentity
        && left.modelIdentity === right.modelIdentity
        && normalizeLocale(left.locale) === normalizeLocale(right.locale);
}

function normalizeLocale(locale: string): string {
    return locale.normalize("NFKC").trim().toLowerCase();
}

function safeAllowed(predicate: (path: string) => boolean, path: string): boolean {
    try {
        return predicate(path) === true;
    } catch {
        return false;
    }
}

function combineAbortSignals(
    primary: AbortSignal,
    secondary: AbortSignal | undefined,
): { signal: AbortSignal; dispose(): void } {
    if (!secondary) return { signal: primary, dispose: () => undefined };
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (primary.aborted || secondary.aborted) {
        controller.abort();
    } else {
        primary.addEventListener("abort", abort, { once: true });
        secondary.addEventListener("abort", abort, { once: true });
    }
    return {
        signal: controller.signal,
        dispose: () => {
            primary.removeEventListener("abort", abort);
            secondary.removeEventListener("abort", abort);
        },
    };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
}

let controllerRunNonce = 0;

function createControllerRunId(sequence: number): string {
    controllerRunNonce = controllerRunNonce >= Number.MAX_SAFE_INTEGER
        ? 1
        : controllerRunNonce + 1;
    return [
        "pagelet-run",
        Date.now().toString(36),
        controllerRunNonce.toString(36),
        sequence.toString(36),
    ].join(":");
}

function safelyNotify(callback: () => void): void {
    try {
        callback();
    } catch {
        // Evidence observers are read-only and must never affect product behavior.
    }
}
