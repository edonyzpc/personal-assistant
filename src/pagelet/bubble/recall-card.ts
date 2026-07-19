/* Copyright 2023 edonyzpc */

import type { QuietRecallCandidate } from "../../pa";
import type { DeliveryCandidate } from "./types";

export interface LocalDiscoveryCandidate {
    id: string;
    sourceRefs: DeliveryCandidate["sourceRefs"];
    relation: QuietRecallCandidate["relation"];
    preparedAt: string;
}

function sourceTitle(path: string): string {
    const name = path.split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export function quietRecallCandidateToDeliveryCandidate(
    candidate: QuietRecallCandidate,
): (DeliveryCandidate & { kind: "recall" }) | null {
    if (
        candidate.evaluationProvenance !== "ai"
        || !candidate.evaluationFingerprint?.trim()
        || candidate.sourceRefs.length === 0
        || candidate.sourceRefs.some((ref) => !ref.path.trim())
    ) return null;
    return quietRecallCandidateToCard(candidate);
}

/** Explicit Discover may show local matches, but this adapter is never used for proactive delivery. */
export function quietRecallCandidateToDiscoveryCandidate(
    candidate: QuietRecallCandidate,
): LocalDiscoveryCandidate | null {
    if (
        candidate.evaluationProvenance === "ai"
        || candidate.sourceRefs.length === 0
        || candidate.sourceRefs.some((ref) => !ref.path.trim())
    ) return null;
    return {
        id: candidate.id,
        sourceRefs: candidate.sourceRefs.map((ref) => ({
            path: ref.path,
            title: sourceTitle(ref.path),
        })),
        relation: candidate.relation,
        preparedAt: candidate.generatedAt,
    };
}

function quietRecallCandidateToCard(
    candidate: QuietRecallCandidate,
): DeliveryCandidate & { kind: "recall" } {
    return {
        id: candidate.id,
        kind: "recall",
        title: candidate.title,
        body: candidate.summary,
        sourceRefs: candidate.sourceRefs.map((ref) => ({
            path: ref.path,
            title: sourceTitle(ref.path),
        })),
        whyNow: candidate.whyNow,
        preparedAt: candidate.generatedAt,
        staleStatus: "fresh",
        route: {
            surface: "tab",
            payloadType: "quiet-recall",
        },
    };
}
