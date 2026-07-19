/* Copyright 2023 edonyzpc */

import {
    buildScopeRecapInsightFingerprint,
    selectStrongestConcreteScopeRecapInsight,
    type ScopeRecapRunResult,
} from "../../pa";
import type { DeliveryCandidate } from "./types";

function sourceTitle(path: string): string {
    const name = path.split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export function scopeRecapToDeliveryCandidate(
    recap: ScopeRecapRunResult,
): (DeliveryCandidate & { kind: "recap" }) | null {
    if (recap.staleStatus !== "fresh") return null;
    const insight = selectStrongestConcreteScopeRecapInsight(recap, 1);
    if (!insight) return null;
    return {
        id: buildScopeRecapInsightFingerprint(recap.scope, insight),
        kind: "recap",
        title: insight.title,
        body: insight.summary,
        sourceRefs: insight.sourceRefs.map((ref) => ({
            path: ref.path,
            title: sourceTitle(ref.path),
        })),
        whyNow: [insight.whyItMatters ?? insight.summary],
        preparedAt: recap.generatedAt,
        staleStatus: recap.staleStatus,
        route: {
            surface: "tab",
            payloadType: "scope-recap",
        },
    };
}
