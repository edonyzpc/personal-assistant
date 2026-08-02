import { isAbortError } from "../../ai-services/chat-utils";
import {
    anchorSnapshotIdentity,
    sameSourceSnapshot,
    sourceSnapshotIdentity,
} from "./anchor-snapshot";
import {
    PageletAgentCache,
    createPageletAgentCacheIdentity,
    hashPageletAgentCacheIdentity,
} from "./pagelet-agent-cache";
import { evaluatePageletAgentQuality } from "./pagelet-agent-quality-gate";
import {
    PAGELET_DEEP_DISCOVER_PIPELINE_VERSION,
    PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS,
} from "./types";
import type {
    PageletAgentPolicyIdentity,
    PageletAgentRuntime,
    PageletAgentSourceMaterial,
    PageletAgentSourceSnapshot,
    PageletAgentValidationIdentity,
    PageletAgentVerifiedInsight,
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

export interface PageletDeepDiscoverControllerDependencies {
    runtime: PageletAgentRuntime;
    captureSnapshot(path: string, signal?: AbortSignal): Promise<PageletAnchorSnapshot | null>;
    captureSourceMaterial(path: string, signal?: AbortSignal): Promise<PageletAgentSourceMaterial | null>;
    getPolicyIdentity(): PageletAgentPolicyIdentity | PromiseLike<PageletAgentPolicyIdentity>;
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
    onResult?: (
        result: PageletDeepDiscoverControllerResult,
        request: PageletDeepDiscoverControllerRequest,
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
        const promise = this.execute(normalizedRequest, combined.signal)
            .then((result) => {
                this.dependencies.onResult?.(result, request);
                return result;
            })
            .catch((error): PageletDeepDiscoverControllerResult => {
                if (isAbortError(error, combined.signal)) {
                    return { status: "quiet", reason: "aborted" };
                }
                return { status: "error", reason: "deep-discover-failed" };
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
            ) return false;
            if (
                identity.webObservations.length > 0
                && (this.dependencies.now ?? Date.now)() - identity.preparedAt
                    >= PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS
            ) return false;

            const policyBefore = await this.dependencies.getPolicyIdentity();
            if (!samePolicyIdentity(expected, policyBefore)) return false;

            const snapshots = new Map<string, PageletAgentSourceSnapshot>();
            snapshots.set(expected.anchor.path, expected.anchor);
            for (const source of expected.sources) snapshots.set(source.path, source);
            for (const snapshot of snapshots.values()) {
                if (signal?.aborted || !safeAllowed(this.dependencies.isPathAllowed, snapshot.path)) {
                    return false;
                }
                const material = await this.dependencies.captureSourceMaterial(snapshot.path, signal);
                if (!material || !sameSourceSnapshot(snapshot, material)) return false;
            }

            if (signal?.aborted) return false;
            const policyAfter = await this.dependencies.getPolicyIdentity();
            return samePolicyIdentity(expected, policyAfter);
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
            const cached = await this.cache.getValid({
                anchor,
                policyIdentity,
                isPathAllowed: this.dependencies.isPathAllowed,
                readSourceSnapshot: async (path, readSignal) => {
                    const material = await this.dependencies.captureSourceMaterial(path, readSignal);
                    return material ? sourceSnapshotIdentity(material) : null;
                },
                now: (this.dependencies.now ?? Date.now)(),
                signal,
            });
            if (cached) {
                const policyAfterCacheRead = await this.dependencies.getPolicyIdentity();
                if (samePolicyIdentity(policyIdentity, policyAfterCacheRead)) {
                    return { status: "cache-hit", insight: cached };
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
            signal,
        });
        throwIfAborted(signal);
        if (run.loopResult.status === "aborted") {
            return { status: "quiet", reason: "aborted", metrics: run.metrics };
        }
        if (!run.finalText) {
            return { status: "quiet", reason: "runtime-incomplete", metrics: run.metrics };
        }

        const sourceMaterials = await this.captureRunSourceMaterials(run.sourceSnapshots, signal);
        if (!sourceMaterials) {
            return { status: "quiet", reason: "stale-source", metrics: run.metrics };
        }
        const currentPolicyIdentity = await this.dependencies.getPolicyIdentity();
        if (!samePolicyIdentity(policyIdentity, currentPolicyIdentity)) {
            return { status: "stale", reason: "policy-identity-changed" };
        }

        const proactiveDelivery = request.triggerReason !== "explicit" && !request.force;
        const quality = await evaluatePageletAgentQuality({
            run,
            sourceMaterials,
            readCurrentSourceSnapshot: async (path, readSignal) => {
                const material = await this.dependencies.captureSourceMaterial(path, readSignal);
                return material ? sourceSnapshotIdentity(material) : null;
            },
            isPathAllowed: this.dependencies.isPathAllowed,
            anchorRelations: this.dependencies.getAnchorRelations?.(anchor.path),
            isDuplicate: proactiveDelivery
                ? (normalizedBody) => this.cache.hasEquivalent(
                    anchor.path,
                    normalizedBody,
                    run.sourceSnapshots,
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
            return { status: "quiet", reason: quality.reason, metrics: run.metrics };
        }

        const cacheIdentity = createPageletAgentCacheIdentity({
            anchor,
            sources: run.sourceSnapshots,
            policyIdentity,
        });
        const insight: PageletAgentVerifiedInsight = {
            body: quality.body,
            normalizedBody: quality.normalizedBody,
            anchor: anchorSnapshotIdentity(anchor),
            sources: quality.sources,
            sourceRefs: quality.sourceRefs,
            cacheIdentity,
            cacheIdentityHash: hashPageletAgentCacheIdentity(cacheIdentity),
            triggerReason: request.triggerReason,
            preparedAt: (this.dependencies.now ?? Date.now)(),
            metrics: run.metrics,
            webObservations: run.webObservations,
        };
        this.cache.put(insight);
        return { status: "verified", insight };
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

function throwIfAborted(signal: AbortSignal): void {
    if (!signal.aborted) return;
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
}
