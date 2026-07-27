/* Copyright 2023 edonyzpc */

import {
    buildScopeRecapInsightFingerprint,
    selectStrongestConcreteScopeRecapInsight,
    type ScopeRecapRunResult,
} from "../../pa";
import type { PageletLocale } from "../../locales/pagelet";
import { buildRecapDeliveryReceipt } from "../attention/fingerprint";
import type { DeliveryCandidate } from "./types";

function sourceTitle(path: string): string {
    const name = path.split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export function scopeRecapToDeliveryCandidate(
    recap: ScopeRecapRunResult,
    locale: PageletLocale,
): (DeliveryCandidate & { kind: "recap" }) | null {
    if (recap.staleStatus !== "fresh") return null;
    const insight = selectStrongestConcreteScopeRecapInsight(recap, 1);
    if (!insight) return null;
    const whyItMatters = insight.whyItMatters ?? insight.summary;
    return {
        id: buildScopeRecapInsightFingerprint(recap.scope, insight),
        kind: "recap",
        title: insight.title,
        body: insight.summary,
        sourceRefs: insight.sourceRefs.map((ref) => ({
            path: ref.path,
            title: sourceTitle(ref.path),
        })),
        whyNow: [whyItMatters],
        preparedAt: recap.generatedAt,
        staleStatus: recap.staleStatus,
        route: {
            surface: "tab",
            payloadType: "scope-recap",
        },
        deliveryReceipt: buildRecapDeliveryReceipt({
            locale,
            title: insight.title,
            body: insight.summary,
            whyItMatters,
            scopeIdentity: recap.scope,
            sourceIdentities: insight.sourceRefs.map((ref) => ref.path),
        }),
    };
}
