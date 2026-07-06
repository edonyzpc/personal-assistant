/* Copyright 2023 edonyzpc */

import type { QuietRecallCandidate } from "../../pa";
import type { DeliveryCandidate } from "./types";

function sourceTitle(path: string): string {
    const name = path.split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export function quietRecallCandidateToDeliveryCandidate(
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
