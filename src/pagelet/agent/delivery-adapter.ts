import { pageletT, type PageletLocale } from "../../locales/pagelet";
import { buildReviewDeliveryReceipt } from "../attention/fingerprint";
import type { DeliveryCandidate } from "../bubble/types";
import type { PageletAgentVerifiedInsight } from "./types";

export function pageletAgentInsightToDeliveryCandidate(
    insight: PageletAgentVerifiedInsight,
    locale: PageletLocale,
): DeliveryCandidate & { kind: "review" } {
    const title = extractInsightTitle(insight.body);
    const whyNow = [localizedWhyNow(insight.triggerReason, locale)];
    return {
        id: insight.cacheIdentityHash,
        kind: "review",
        title,
        body: insight.body,
        sourceRefs: insight.sourceRefs.map((source) => ({
            path: source.path,
            title: sourceTitle(source.path),
        })),
        whyNow,
        preparedAt: new Date(insight.preparedAt).toISOString(),
        staleStatus: "fresh",
        route: {
            surface: "panel",
            payloadType: "pagelet-agent-insight-v1",
        },
        deliveryReceipt: buildReviewDeliveryReceipt({
            locale,
            title,
            body: insight.body,
            anchorSourceIdentity: insight.anchor.path,
            sourceIdentities: insight.sources.map((source) => source.path),
        }),
    };
}

function localizedWhyNow(
    triggerReason: PageletAgentVerifiedInsight["triggerReason"],
    locale: PageletLocale,
): string {
    switch (triggerReason) {
        case "explicit":
            return pageletT("pagelet.bubble.agentInsight.whyNow.explicit", locale);
        case "leave-note":
            return pageletT("pagelet.bubble.agentInsight.whyNow.leaveNote", locale);
        case "edit-idle":
            return pageletT("pagelet.bubble.agentInsight.whyNow.editIdle", locale);
        case "open-changed-note":
            return pageletT("pagelet.bubble.agentInsight.whyNow.openChangedNote", locale);
        default:
            return pageletT("pagelet.bubble.agentInsight.whyNow.generic", locale);
    }
}

function extractInsightTitle(body: string): string {
    for (const line of body.split(/\r?\n/)) {
        const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
        if (heading?.[1]?.trim()) return truncateTitle(heading[1].trim());
    }
    const plain = body
        .replace(/^\s*[-*>#]+\s*/gm, "")
        .replace(/\s+/g, " ")
        .trim();
    const firstSentence = plain.match(/^(.+?[。！？.!?])(?:\s|$)/u)?.[1] ?? plain;
    return truncateTitle(firstSentence || "Deep Discover");
}

function truncateTitle(value: string): string {
    return value.length > 96 ? `${value.slice(0, 95).trimEnd()}…` : value;
}

function sourceTitle(path: string): string {
    return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}
