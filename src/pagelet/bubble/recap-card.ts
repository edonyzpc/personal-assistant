/* Copyright 2023 edonyzpc */

import type { ScopeRecapRunResult } from "../../pa";
import type { DeliveryCandidate } from "./types";
import { getPageletUiLanguage, pageletT } from "../../locales/pagelet";

function sourceTitle(path: string): string {
    const name = path.split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export function scopeRecapToDeliveryCandidate(
    recap: ScopeRecapRunResult,
): (DeliveryCandidate & { kind: "recap" }) | null {
    if (recap.staleStatus !== "fresh") return null;
    if (recap.sourceCoverage.coverageRatio <= 0 || recap.sourceRefs.length === 0) return null;
    return {
        id: recap.id,
        kind: "recap",
        title: recap.scope.label ?? pageletT("pagelet.bubble.recapDelivery.fallbackTitle", getPageletUiLanguage()),
        body: recap.summary.summary,
        sourceRefs: recap.sourceRefs.map((ref) => ({
            path: ref.path,
            title: sourceTitle(ref.path),
        })),
        whyNow: [
            pageletT("pagelet.bubble.recapDelivery.coverage", getPageletUiLanguage(), {
                included: recap.sourceCoverage.includedSourceCount,
            }),
        ],
        preparedAt: recap.generatedAt,
        staleStatus: recap.staleStatus,
        route: {
            surface: "tab",
            payloadType: "scope-recap",
        },
    };
}
