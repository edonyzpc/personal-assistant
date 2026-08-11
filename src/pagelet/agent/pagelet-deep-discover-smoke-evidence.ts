import { stableStringify } from "../../ai-services/agent-utils";
import { getPlatformCrypto } from "../../platform-dom";
import type { DeliveryReceipt } from "../attention";
import {
    createPageletInsightCollectionId,
    isPageletVerifiedInsightIdentityValid,
} from "./pagelet-agent-cache";
import type { PageletAgentDeliveryCandidate } from "./delivery-adapter";
import type {
    PageletDeepDiscoverControllerRunCompletion,
    PageletDeepDiscoverControllerRunIdentity,
} from "./pagelet-deep-discover-controller";
import type { PageletDeepDiscoverControllerResult } from "./types";

export interface PageletDeepDiscoverSmokeInsightSnapshot {
    readonly insightId: string;
    readonly sourcePaths: readonly string[];
    readonly candidateId: string;
    readonly deliveryReceipt: Readonly<DeliveryReceipt>;
    /** SHA-256 of the content-free production receipt DTO. */
    readonly deliveryReceiptSha256: string;
}

export interface PageletDeepDiscoverSmokeSnapshot {
    readonly schemaVersion: 1;
    /** Monotonic within one loaded plugin instance, including controller resets. */
    readonly sequence: number;
    readonly controllerSequence: number;
    readonly runId: string;
    readonly resultId: string;
    readonly entryPath: string;
    readonly triggerReason: string;
    readonly force: boolean;
    readonly resultStatus: PageletDeepDiscoverControllerResult["status"];
    readonly reason: string | null;
    readonly collectionId: string | null;
    readonly insights: readonly PageletDeepDiscoverSmokeInsightSnapshot[];
    readonly candidateCount: number;
    readonly deliveryReceiptCount: number;
    readonly cacheMutationCount: number;
    readonly cacheEntryCountBefore: number;
    readonly cacheEntryCountAfter: number;
    readonly quietWriteInvariantSatisfied: boolean;
}

interface PendingRun {
    readonly sequence: number;
    readonly identity: PageletDeepDiscoverControllerRunIdentity;
    readonly terminal?: {
        readonly completion: PageletDeepDiscoverControllerRunCompletion;
        readonly result: PageletDeepDiscoverControllerResult;
    };
}

interface RawInsightSnapshot {
    readonly insightId: string;
    readonly sourcePaths: readonly string[];
    readonly candidateId: string;
    readonly deliveryReceipt: Readonly<DeliveryReceipt>;
}

interface RawSnapshot extends Omit<PageletDeepDiscoverSmokeSnapshot, "insights"> {
    readonly insights: readonly RawInsightSnapshot[];
}

type ReceiptDigest = (receipt: Readonly<DeliveryReceipt>) => Promise<string | null>;

/**
 * A single-entry, content-free bridge from a real controller completion to the
 * local app-smoke runner. It never persists evidence and never invokes a model.
 */
export class PageletDeepDiscoverSmokeEvidenceStore {
    private nextSequence = 0;
    private pending: PendingRun | null = null;
    private completed: RawSnapshot | null = null;

    constructor(private readonly digestReceipt: ReceiptDigest = sha256Receipt) {}

    begin(identity: PageletDeepDiscoverControllerRunIdentity): void {
        // The smoke runner explicitly requests a forced foreground run. Keep
        // that evidence isolated from unrelated leave-note/edit-idle work,
        // which may start or finish in either order around the foreground run.
        if (!isExplicitSmokeRun(identity)) return;
        this.nextSequence = this.nextSequence >= Number.MAX_SAFE_INTEGER
            ? 1
            : this.nextSequence + 1;
        this.pending = Object.freeze({
            sequence: this.nextSequence,
            identity,
        });
        // A new explicit controller run makes every older completion stale.
        this.completed = null;
    }

    stageControllerResult(
        completion: PageletDeepDiscoverControllerRunCompletion,
        result: PageletDeepDiscoverControllerResult,
    ): void {
        const pending = this.pending;
        if (!pending || !sameRun(pending.identity, completion)) return;
        this.pending = Object.freeze({
            ...pending,
            terminal: Object.freeze({ completion, result }),
        });
        this.completed = null;
    }

    /**
     * Complete evidence only after the Orchestrator accepts the exact result
     * on its still-current route. Candidates are the actual accepted adapter
     * objects, never a second projection made by this store.
     */
    acknowledgeOrchestratorResult(
        result: PageletDeepDiscoverControllerResult,
        candidates: readonly PageletAgentDeliveryCandidate[],
    ): void {
        const pending = this.pending;
        if (!pending?.terminal || pending.terminal.result !== result) return;
        this.pending = null;
        try {
            this.completed = buildRawSnapshot(
                pending.sequence,
                pending.terminal.completion,
                result,
                candidates,
            );
        } catch {
            this.completed = null;
        }
    }

    /** Discard only the matching stale route; never clear a newer pending run. */
    discardOrchestratorResult(result: PageletDeepDiscoverControllerResult): void {
        if (this.pending?.terminal?.result !== result) return;
        this.pending = null;
        this.completed = null;
    }

    async snapshot(): Promise<PageletDeepDiscoverSmokeSnapshot | null> {
        const raw = this.completed;
        if (!raw) return null;
        const insights: PageletDeepDiscoverSmokeInsightSnapshot[] = [];
        for (const insight of raw.insights) {
            const deliveryReceiptSha256 = await this.digestReceipt(insight.deliveryReceipt);
            if (!deliveryReceiptSha256 || !/^[a-f0-9]{64}$/u.test(deliveryReceiptSha256)) {
                return null;
            }
            insights.push(Object.freeze({
                ...insight,
                deliveryReceiptSha256,
            }));
        }
        // Hashing is asynchronous; reject a snapshot superseded in the meantime.
        if (this.completed !== raw || this.pending !== null) return null;
        return freezeSnapshot({
            ...raw,
            insights,
        });
    }

    clear(): void {
        this.pending = null;
        this.completed = null;
    }
}

function isExplicitSmokeRun(identity: PageletDeepDiscoverControllerRunIdentity): boolean {
    return identity.triggerReason === "explicit" && identity.force;
}

function buildRawSnapshot(
    sequence: number,
    completion: PageletDeepDiscoverControllerRunCompletion,
    result: PageletDeepDiscoverControllerResult,
    acceptedCandidates: readonly PageletAgentDeliveryCandidate[],
): RawSnapshot | null {
    const cacheMutationCount = completion.cacheAfter.version - completion.cacheBefore.version;
    if (!Number.isSafeInteger(cacheMutationCount) || cacheMutationCount < 0) return null;

    let collectionId: string | null = null;
    let candidates: readonly PageletAgentDeliveryCandidate[] = [];
    let insights: RawInsightSnapshot[] = [];
    if (result.status === "verified" || result.status === "cache-hit") {
        if (!validCommittedResult(result, completion.anchorPath)) return null;
        collectionId = result.collection.collectionId;
        candidates = acceptedCandidates;
        if (candidates.length !== result.insights.length) return null;
        insights = result.insights.map((insight, index) => {
            const candidate = candidates[index];
            if (!candidate) throw new Error("Missing production Pagelet delivery candidate.");
            const sourcePaths = insight.sourceRefs.map((source) => source.path);
            if (
                candidate.id !== insight.insightId
                || candidate.pageletAgent.validationIdentity.insightId !== insight.insightId
                || !candidate.deliveryReceipt
                || candidate.deliveryReceipt.kind !== "review"
                || sourcePaths.join("\u0000")
                    !== candidate.sourceRefs.map((source) => source.path).join("\u0000")
            ) {
                throw new Error("Production Pagelet delivery projection does not match its result.");
            }
            return Object.freeze({
                insightId: insight.insightId,
                sourcePaths: Object.freeze([...sourcePaths]),
                candidateId: candidate.id,
                deliveryReceipt: freezeReceipt(candidate.deliveryReceipt),
            });
        });
        if (
            new Set(insights.map((insight) => insight.candidateId)).size !== insights.length
            || new Set(insights.map((insight) => insight.deliveryReceipt.fingerprint)).size
                !== insights.length
        ) return null;
    } else if (acceptedCandidates.length > 0) {
        return null;
    }

    const deliveryReceiptCount = candidates.filter((candidate) => (
        candidate.deliveryReceipt !== undefined
    )).length;
    const quietWriteInvariantSatisfied = result.status === "quiet"
        && cacheMutationCount === 0
        && candidates.length === 0
        && deliveryReceiptCount === 0;
    return Object.freeze({
        schemaVersion: 1,
        sequence,
        controllerSequence: completion.sequence,
        runId: completion.runId,
        resultId: completion.resultId,
        entryPath: completion.anchorPath,
        triggerReason: String(completion.triggerReason),
        force: completion.force,
        resultStatus: result.status,
        reason: "reason" in result ? result.reason : null,
        collectionId,
        insights: Object.freeze(insights),
        candidateCount: candidates.length,
        deliveryReceiptCount,
        cacheMutationCount,
        cacheEntryCountBefore: completion.cacheBefore.entryCount,
        cacheEntryCountAfter: completion.cacheAfter.entryCount,
        quietWriteInvariantSatisfied,
    });
}

function validCommittedResult(
    result: Extract<PageletDeepDiscoverControllerResult, { status: "verified" | "cache-hit" }>,
    anchorPath: string,
): boolean {
    if (
        result.insights.length < 1
        || result.insights.length > 2
        || result.collection.insights.length !== result.insights.length
        || result.insight.insightId !== result.insights[0]?.insightId
        || result.collection.anchor.path !== anchorPath
        || result.collection.collectionId !== createPageletInsightCollectionId(
            result.insights.map((insight) => insight.insightId),
        )
    ) return false;
    const insightIds = new Set<string>();
    for (let index = 0; index < result.insights.length; index += 1) {
        const insight = result.insights[index];
        const committed = result.collection.insights[index];
        if (
            !insight
            || !committed
            || insight.insightId !== committed.insightId
            || insight.collectionId !== result.collection.collectionId
            || insight.anchor.path !== anchorPath
            || !isPageletVerifiedInsightIdentityValid(insight)
            || !isPageletVerifiedInsightIdentityValid(committed)
            || insightIds.has(insight.insightId)
        ) return false;
        insightIds.add(insight.insightId);
        const sourcePaths = insight.sourceRefs.map((source) => source.path);
        const committedSourcePaths = new Set(insight.sources.map((source) => source.path));
        if (
            !sourcePaths.includes(anchorPath)
            || sourcePaths.length !== new Set(sourcePaths).size
            || sourcePaths.length !== committedSourcePaths.size
            || sourcePaths.some((path) => !committedSourcePaths.has(path))
        ) return false;
    }
    return true;
}

function sameRun(
    started: PageletDeepDiscoverControllerRunIdentity,
    completed: PageletDeepDiscoverControllerRunCompletion,
): boolean {
    return started.schemaVersion === completed.schemaVersion
        && started.runId === completed.runId
        && started.sequence === completed.sequence
        && started.anchorPath === completed.anchorPath
        && started.triggerReason === completed.triggerReason
        && started.force === completed.force
        && started.cacheBefore.version === completed.cacheBefore.version
        && started.cacheBefore.entryCount === completed.cacheBefore.entryCount;
}

async function sha256Receipt(receipt: Readonly<DeliveryReceipt>): Promise<string | null> {
    try {
        const subtle = getPlatformCrypto()?.subtle;
        if (!subtle) return null;
        const digest = await subtle.digest(
            "SHA-256",
            new TextEncoder().encode(stableStringify(receipt)),
        );
        return [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    } catch {
        return null;
    }
}

function freezeReceipt(receipt: DeliveryReceipt): Readonly<DeliveryReceipt> {
    return Object.freeze({
        version: receipt.version,
        kind: receipt.kind,
        fingerprint: receipt.fingerprint,
    });
}

function freezeSnapshot(
    snapshot: PageletDeepDiscoverSmokeSnapshot,
): PageletDeepDiscoverSmokeSnapshot {
    return Object.freeze({
        ...snapshot,
        insights: Object.freeze(snapshot.insights.map((insight) => Object.freeze({
            ...insight,
            sourcePaths: Object.freeze([...insight.sourcePaths]),
            deliveryReceipt: freezeReceipt(insight.deliveryReceipt),
        }))),
    });
}
