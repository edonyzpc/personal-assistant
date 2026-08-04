/* Copyright 2023 edonyzpc */

import type { QuietRecallCandidate } from "../../pa";
import { noteTitleFromPath } from "../../pa/helpers";
import type { PageletLocale } from "../../locales/pagelet";
import { buildRecallDeliveryReceipt } from "../attention/fingerprint";
import type { DeliveryCandidate } from "./types";

export interface LocalDiscoveryCandidate {
    id: string;
    sourceRefs: DeliveryCandidate["sourceRefs"];
    relation: QuietRecallCandidate["relation"];
    preparedAt: string;
}


export function quietRecallCandidateToDeliveryCandidate(
    candidate: QuietRecallCandidate,
    locale: PageletLocale,
    currentPath?: string,
): (DeliveryCandidate & { kind: "recall" }) | null {
    if (
        candidate.evaluationProvenance !== "ai"
        || !candidate.evaluationFingerprint?.trim()
        || candidate.sourceRefs.length === 0
        || candidate.sourceRefs.some((ref) => !ref.path.trim())
    ) return null;
    return quietRecallCandidateToCard(candidate, locale, currentPath);
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
            title: noteTitleFromPath(ref.path),
        })),
        relation: candidate.relation,
        preparedAt: candidate.generatedAt,
    };
}

function quietRecallCandidateToCard(
    candidate: QuietRecallCandidate,
    locale: PageletLocale,
    currentPath?: string,
): DeliveryCandidate & { kind: "recall" } {
    return {
        id: candidate.id,
        kind: "recall",
        title: candidate.title,
        body: candidate.summary,
        sourceRefs: candidate.sourceRefs.map((ref) => ({
            path: ref.path,
            title: noteTitleFromPath(ref.path),
        })),
        whyNow: candidate.whyNow,
        preparedAt: candidate.generatedAt,
        staleStatus: "fresh",
        route: {
            surface: "tab",
            payloadType: "quiet-recall",
        },
        deliveryReceipt: buildRecallDeliveryReceipt({
            locale,
            title: candidate.title,
            body: candidate.summary,
            whyNow: candidate.whyNow,
            currentSourceIdentity: currentPath,
            recalledSourceIdentities: candidate.sourceRefs.map((ref) => ref.path),
        }),
    };
}
