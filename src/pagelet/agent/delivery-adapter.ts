import { pageletT, type PageletLocale } from "../../locales/pagelet";
import {
    createPageletChatHandoffContext,
    type PageletChatHandoffContext,
} from "../../ai-services/pagelet-handoff";
import { noteTitleFromPath, normalizeVaultPath } from "../../pa/helpers";
import { buildReviewDeliveryReceipt } from "../attention/fingerprint";
import type { DeliveryCandidate } from "../bubble/types";
import type {
    PageletAgentValidationIdentity,
    PageletAgentVerifiedInsight,
    PageletAgentVerifiedInsightCollection,
} from "./types";

export interface PageletAgentDirectLinkAction {
    readonly kind: "link-related";
    readonly candidateId: string;
    readonly anchorPath: string;
    readonly sourcePath: string;
    readonly label: string;
}

export interface PageletAgentDeliveryIntegration {
    readonly validationIdentity: PageletAgentValidationIdentity;
    readonly handoff: PageletChatHandoffContext;
    readonly directAction?: PageletAgentDirectLinkAction;
}

export type PageletAgentDeliveryCandidate = DeliveryCandidate & {
    kind: "review";
    readonly pageletAgent: PageletAgentDeliveryIntegration;
};

export function pageletAgentInsightToDeliveryCandidate(
    insight: PageletAgentVerifiedInsight,
    locale: PageletLocale,
): PageletAgentDeliveryCandidate {
    const title = extractInsightTitle(insight.body);
    const whyNow = [localizedWhyNow(insight.triggerReason, locale)];
    const directAction = buildDirectLinkAction(insight, locale);
    const validationIdentity = freezeValidationIdentity(insight);
    const handoff = createPageletChatHandoffContext({
        version: 1,
        id: insight.insightId,
        body: insight.body,
        anchor: insight.anchor,
        sources: insight.sources,
        sourceRefs: insight.sourceRefs.map((source) => ({
            path: source.path,
            title: noteTitleFromPath(source.path),
        })),
        webUrls: [...new Set(insight.webObservations.map((observation) => observation.url))],
        whyNow,
        triggerReason: insight.triggerReason,
        preparedAt: insight.preparedAt,
        pipelineVersion: insight.cacheIdentity.pipelineVersion,
    });
    return {
        id: insight.insightId,
        kind: "review",
        title,
        body: insight.body,
        sourceRefs: insight.sourceRefs.map((source) => ({
            path: source.path,
            title: noteTitleFromPath(source.path),
        })),
        whyNow,
        preparedAt: new Date(insight.preparedAt).toISOString(),
        staleStatus: "fresh",
        route: {
            surface: "panel",
            payloadType: "pagelet-agent-insight-v1",
        },
        deliveryReceipt: buildReviewDeliveryReceipt({
            insightId: insight.insightId,
            locale,
            title,
            body: insight.body,
            anchorSourceIdentity: insight.anchor.path,
            sourceIdentities: insight.sources.map((source) => source.path),
        }),
        pageletAgent: Object.freeze({
            validationIdentity,
            handoff,
            ...(directAction ? { directAction } : {}),
        }),
    };
}

export function pageletAgentCollectionToDeliveryCandidates(
    collection: PageletAgentVerifiedInsightCollection,
    locale: PageletLocale,
): PageletAgentDeliveryCandidate[] {
    return collection.insights.map((insight) => (
        pageletAgentInsightToDeliveryCandidate(insight, locale)
    ));
}

function buildDirectLinkAction(
    insight: PageletAgentVerifiedInsight,
    locale: PageletLocale,
): PageletAgentDirectLinkAction | undefined {
    const anchorPath = normalizeVaultPath(insight.anchor.path);
    const related = insight.sources.find(
        (source) => normalizeVaultPath(source.path) !== anchorPath,
    );
    if (!related) return undefined;
    const anchorTitle = noteTitleFromPath(insight.anchor.path);
    const relatedTitle = noteTitleFromPath(related.path);
    return Object.freeze({
        kind: "link-related",
        candidateId: insight.insightId,
        anchorPath: insight.anchor.path,
        sourcePath: related.path,
        label: pageletT("pagelet.panel.agentInsight.link", locale, {
            anchor: anchorTitle,
            source: relatedTitle,
        }),
    });
}

function freezeValidationIdentity(
    insight: PageletAgentVerifiedInsight,
): PageletAgentValidationIdentity {
    return Object.freeze({
        cacheIdentity: Object.freeze({
            ...insight.cacheIdentity,
            anchor: Object.freeze({ ...insight.cacheIdentity.anchor }),
            sources: Object.freeze(insight.cacheIdentity.sources.map((source) => (
                Object.freeze({ ...source })
            ))),
        }),
        cacheIdentityHash: insight.cacheIdentityHash,
        preparedAt: insight.preparedAt,
        webObservations: Object.freeze(insight.webObservations.map((observation) => (
            Object.freeze({ ...observation })
        ))),
        insightId: insight.insightId,
        normalizedBody: insight.normalizedBody,
        normalizedClaim: insight.normalizedClaim,
    });
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
