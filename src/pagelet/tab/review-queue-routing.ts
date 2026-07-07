/* Copyright 2023 edonyzpc */

/**
 * ReviewQueue item routing — splits items into Memory and Maintenance domains.
 *
 * Memory-domain types route to MemoryGovernanceSection.
 * Maintenance-domain types route to MaintenanceReviewSection.
 * memory_candidate / memory_conflict are EXCLUDED because they are already
 * delivered through the separate candidates pipeline in withGlobalLedgerExtra().
 */

import type { ReviewQueueItem, ReviewQueueItemType } from "../../pa";

export type ReviewQueueRouteTarget = "memory" | "maintenance";

const MEMORY_TYPES: ReadonlySet<ReviewQueueItemType> = new Set([
    "evidence_insight",
    "capture_enrichment",
    "task_suggestion",
    "recall_suggestion",
    "theme_chain",
    "review_summary",
]);

const EXCLUDED_TYPES: ReadonlySet<ReviewQueueItemType> = new Set([
    "memory_candidate",
    "memory_conflict",
]);

export function routeReviewQueueItem(item: ReviewQueueItem): ReviewQueueRouteTarget {
    if (MEMORY_TYPES.has(item.type)) return "memory";
    return "maintenance";
}

export function splitReviewQueueForSections(items: ReviewQueueItem[]): {
    memory: ReviewQueueItem[];
    maintenance: ReviewQueueItem[];
} {
    const memory: ReviewQueueItem[] = [];
    const maintenance: ReviewQueueItem[] = [];
    for (const item of items) {
        if (EXCLUDED_TYPES.has(item.type)) continue;
        if (MEMORY_TYPES.has(item.type)) {
            memory.push(item);
        } else {
            maintenance.push(item);
        }
    }
    return { memory, maintenance };
}
