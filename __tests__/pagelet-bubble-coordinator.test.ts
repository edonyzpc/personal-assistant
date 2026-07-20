import { describe, expect, it, jest } from "@jest/globals";

import { BubbleCoordinator } from "../src/pagelet/BubbleCoordinator";
import type { BubbleContent } from "../src/pagelet/bubble/types";
import type { BubbleView } from "../src/pagelet/bubble/BubbleView";
import type { PageletHost } from "../src/pagelet/PageletHost";
import type { PetView } from "../src/pagelet/pet/PetView";
import { ProactiveHints } from "../src/pagelet/hints/ProactiveHints";
import { PreloadCache } from "../src/pagelet/preload/PreloadCache";
import type { ReviewQueueListFilter, ReviewQueueItem } from "../src/pa";

function makeHost(
    listReviewQueueItems: (filter?: ReviewQueueListFilter) => ReviewQueueItem[],
    overrides: Partial<PageletHost> = {},
): PageletHost {
    return {
        app: {
            workspace: {
                getActiveFile: () => ({
                    path: "notes/current.md",
                    extension: "md",
                    stat: { size: 120 },
                }),
            },
        },
        settings: {
            pagelet: {
                enabled: true,
                onboardingShown: true,
                proactiveHints: true,
                quietAcknowledged: false,
            },
            quietRecall: {
                enabled: true,
                bubbleNudgesEnabled: false,
            },
        },
        listReviewQueueItems,
        updatePageletSetting: jest.fn(),
        prepareMemoryForPagelet: jest.fn(),
        openQuickCapture: jest.fn(),
        openPageletSettings: jest.fn(),
        isPathAllowedForPagelet: () => true,
        isMemoryReadyForPageletDiscovery: async () => true,
        getMemoryPreparationStatus: () => null,
        runQuietRecall: async () => ({
            generatedAt: "2026-07-05T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 0,
            candidates: [],
        }),
        linkRecallCandidate: jest.fn(),
        log: jest.fn(),
        ...overrides,
    } as unknown as PageletHost;
}

function makeBubbleView(): BubbleView {
    const view = {
        bubbleState: "hidden",
        show: jest.fn(() => { view.bubbleState = "visible"; }),
        close: jest.fn(() => { view.bubbleState = "hidden"; }),
    };
    return view as unknown as BubbleView;
}

function makePetView(): PetView {
    return {
        rootEl: {} as HTMLElement,
    } as unknown as PetView;
}

function makeCoordinator(
    listReviewQueueItems: (filter?: ReviewQueueListFilter) => ReviewQueueItem[],
    hostOverrides: Partial<PageletHost> = {},
    overrides: Partial<ConstructorParameters<typeof BubbleCoordinator>[3]> = {},
): BubbleCoordinator {
    return new BubbleCoordinator(
        makeHost(listReviewQueueItems, hostOverrides),
        new PreloadCache(),
        new ProactiveHints({
            enabled: true,
            cooldownMinutes: 30,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        }),
        {
            onExpandPanel: jest.fn(),
            onSourceClick: jest.fn(),
            onDismiss: jest.fn(),
            onReviewCurrentNote: jest.fn(),
            onDiscoverConnections: jest.fn(),
            getOnboardingNudge: () => null,
            onOnboardingNudgeDismiss: jest.fn(),
            getQuietRecallNudge: () => null,
            getQuietRecallCandidate: () => null,
            onQuietRecallView: jest.fn(),
            onQuietRecallLink: jest.fn(),
            onQuietRecallDismiss: jest.fn(),
            onQuietRecallLater: jest.fn(),
            getPatternDetectionNudge: () => null,
            onPatternDetectionView: jest.fn(),
            onPatternDetectionDismiss: jest.fn(),
            getPreparedRecapCandidate: () => null,
            getPreparedRecapNudgeCandidate: () => null,
            onPreparedRecapView: jest.fn(),
            onPreparedRecapLater: jest.fn(),
            getUnconvincingRecallCount: () => 0,
            ...overrides,
            onQuietRecallDiscoverOnly: overrides.onQuietRecallDiscoverOnly ?? jest.fn(),
        },
    );
}

function shownContent(bubbleView: BubbleView): BubbleContent {
    const show = bubbleView.show as unknown as jest.Mock;
    return show.mock.calls[show.mock.calls.length - 1][0] as BubbleContent;
}

describe("BubbleCoordinator Review Queue reminders", () => {
    it("routes a Discover-only context action to Quiet Recall local candidates", () => {
        const onDiscoverConnections = jest.fn();
        const onQuietRecallDiscoverOnly = jest.fn();
        const coordinator = makeCoordinator(() => [], {}, {
            onDiscoverConnections,
            onQuietRecallDiscoverOnly,
            getUnconvincingRecallCount: () => 2,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        const contextAction = shownContent(bubbleView).contextAction;

        expect(contextAction).toEqual(expect.objectContaining({
            label: "2 related notes found",
            action: "discover",
        }));
        contextAction?.callback();
        expect(onQuietRecallDiscoverOnly).toHaveBeenCalledTimes(1);
        expect(onDiscoverConnections).not.toHaveBeenCalled();
    });

    it("does not show a Discover-only context action when there are no local candidates", () => {
        const coordinator = makeCoordinator(() => [], {}, {
            getUnconvincingRecallCount: () => 0,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());

        expect(shownContent(bubbleView).contextAction).toBeUndefined();
    });

    it("does not turn Review Queue items into Bubble work", async () => {
        const listReviewQueueItems = jest.fn((filter?: ReviewQueueListFilter) => {
            return [];
        });
        const coordinator = makeCoordinator(listReviewQueueItems);
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        await Promise.resolve();

        const content = shownContent(bubbleView);
        expect(content.type).toBe("ready-empty");
        expect(content.findings[0]?.text).not.toContain("Review Queue");
        expect(content.findings[0]?.text).not.toContain("waiting");
        expect(content.actions.map((action) => action.label)).toEqual(["Find related old notes"]);
        expect(listReviewQueueItems).not.toHaveBeenCalled();
    });

    it("preserves focus when Memory readiness refresh repaints a visible bubble", async () => {
        const coordinator = makeCoordinator(() => [], {
            isMemoryReadyForPageletDiscovery: async () => true,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        await Promise.resolve();
        await Promise.resolve();

        const show = bubbleView.show as unknown as jest.Mock;
        expect(show).toHaveBeenCalledTimes(2);
        expect(show.mock.calls[1]?.[2]).toEqual({ preserveFocus: true });
    });

    it("does not show user-kept Review Queue states as pending Bubble work", async () => {
        const listReviewQueueItems = jest.fn((_filter?: ReviewQueueListFilter) => {
            return [
                { id: "rq-accepted", status: "accepted", admissionReason: "user_kept_for_later" },
                { id: "rq-snoozed", status: "snoozed", admissionReason: "user_kept_for_later" },
                { id: "rq-legacy", status: "snoozed", admissionReason: "legacy_pre_refactor" },
            ] as ReviewQueueItem[];
        });
        const coordinator = makeCoordinator(listReviewQueueItems);
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        await Promise.resolve();

        const content = shownContent(bubbleView);
        expect(content.type).toBe("ready-empty");
        expect(JSON.stringify(content)).not.toContain("later items");
        expect(listReviewQueueItems).not.toHaveBeenCalled();
    });

    it("shows prepared Recap Delivery only when a recap candidate already exists", () => {
        const onPreparedRecapView = jest.fn();
        const candidate = {
            id: "recap-1",
            kind: "recap" as const,
            title: "Projects/PA",
            body: "The scope has a prepared recap.",
            sourceRefs: [{ path: "Projects/PA/A.md", title: "A" }],
            whyNow: ["2/2 source notes are covered in this scope."],
            preparedAt: "2026-07-05T12:00:00.000Z",
            staleStatus: "fresh" as const,
            route: { surface: "tab" as const, payloadType: "scope-recap" },
        };
        const coordinator = makeCoordinator(() => [], {}, {
            getPreparedRecapCandidate: () => candidate,
            onPreparedRecapView,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());

        const content = shownContent(bubbleView);
        expect(content.type).toBe("recap-delivery");
        expect(JSON.stringify(content)).not.toContain("Generate summary");
        expect(content.actions.map((action) => action.label)).toEqual(["View recap", "Later"]);

        content.actions[0].callback();
        expect(onPreparedRecapView).toHaveBeenCalledWith(candidate);
    });

    it("shows a prepared Recap from the nudge path only when its high-value nudge is pending", () => {
        const candidate = {
            id: "recap-nudge-1",
            kind: "recap" as const,
            title: "Trust is becoming the shared design constraint",
            body: "Two source notes connect instant value with source-backed trust.",
            sourceRefs: [
                { path: "Projects/PA/A.md", title: "A" },
                { path: "Projects/PA/B.md", title: "B" },
            ],
            whyNow: ["A concrete cross-note insight is ready."],
            preparedAt: "2026-07-05T12:00:00.000Z",
            staleStatus: "fresh" as const,
            route: { surface: "tab" as const, payloadType: "scope-recap" },
        };
        const coordinator = makeCoordinator(() => [], {}, {
            getPreparedRecapCandidate: () => candidate,
            getPreparedRecapNudgeCandidate: () => candidate,
        });
        const bubbleView = makeBubbleView();

        coordinator.showNudgeBubble(bubbleView, makePetView());

        expect(shownContent(bubbleView).type).toBe("recap-delivery");
    });

    it("shows Needs Setup from the readiness snapshot before Memory is ready", () => {
        const coordinator = makeCoordinator(() => [], {
            isMemoryReadyForPageletDiscovery: async () => false,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());

        const content = shownContent(bubbleView);
        expect(content.type).toBe("needs-setup");
        expect(content.actions.map((action) => action.label)).toEqual(["Prepare Memory", "Review this note"]);
    });

    it("keeps Data Boundary explanation ahead of Memory setup and short-note fallbacks", () => {
        const coordinator = makeCoordinator(() => [], {
            isMemoryReadyForPageletDiscovery: async () => false,
            isPathAllowedForPagelet: () => false,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());

        const content = shownContent(bubbleView);
        expect(content.type).toBe("context-limited");
        expect(content.actions.map((action) => action.label)).toEqual(["View boundary settings"]);
    });

    it("does not display stale cards when an ordinary Bubble Discover run is no longer current", async () => {
        const recall: Awaited<ReturnType<PageletHost["runQuietRecall"]>> = {
            generatedAt: "2026-07-05T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 1,
            candidates: [{
                id: "recall-stale",
                title: "Recall: Stale",
                summary: "This stale candidate must not render.",
                sourceRefs: [{ path: "notes/stale.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
                whyNow: ["Its evaluation context has changed."],
                nextAction: "Open it.",
                relation: "related",
                score: 80,
                generatedAt: "2026-07-05T12:00:00.000Z",
            }],
        };
        const runQuietRecall = jest.fn(async () => recall);
        const isQuietRecallRunCurrent = jest.fn<(_result: typeof recall) => boolean>(() => false);
        const onSourceClick = jest.fn();
        const coordinator = makeCoordinator(() => [], {
            runQuietRecall,
            isQuietRecallRunCurrent,
        }, { onSourceClick });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        await Promise.resolve();
        shownContent(bubbleView).actions[0].callback();
        await Promise.resolve();
        await Promise.resolve();

        const show = bubbleView.show as unknown as jest.Mock;
        const shownTypes = show.mock.calls.map(([content]) => (content as BubbleContent).type);
        expect(runQuietRecall).toHaveBeenCalledTimes(1);
        expect(isQuietRecallRunCurrent).toHaveBeenCalledWith(recall);
        expect(shownTypes).not.toContain("recall-delivery");
        expect(JSON.stringify(show.mock.calls)).not.toContain("This stale candidate must not render.");
        expect(bubbleView.close).toHaveBeenCalledTimes(1);
        expect(bubbleView.bubbleState).toBe("hidden");
        expect(onSourceClick).not.toHaveBeenCalled();
    });

    it("does not publish Bubble Discover results after the active note changes", async () => {
        let activePath = "notes/current.md";
        let resolveRecall = (): void => undefined;
        const runQuietRecall = jest.fn(() => new Promise<Awaited<ReturnType<PageletHost["runQuietRecall"]>>>((resolve) => {
            resolveRecall = () => resolve({
                generatedAt: "2026-07-05T12:00:00.000Z",
                currentPath: "notes/current.md",
                totalCount: 1,
                candidates: [{
                    id: "recall-alpha",
                    title: "Recall: Alpha",
                    summary: "Alpha may matter again.",
                    sourceRefs: [{ path: "notes/alpha.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
                    whyNow: ["Source appears near the current note in Memory search."],
                    nextAction: "Open it.",
                    relation: "related" as const,
                    score: 80,
                    generatedAt: "2026-07-05T12:00:00.000Z",
                }],
            });
        }));
        const coordinator = makeCoordinator(() => [], {
            app: {
                workspace: {
                    getActiveFile: () => ({
                        path: activePath,
                        extension: "md",
                        stat: { size: 120 },
                    }),
                },
            } as unknown as PageletHost["app"],
            runQuietRecall,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        await Promise.resolve();
        shownContent(bubbleView).actions[0].callback();
        expect(shownContent(bubbleView).findings[0]?.text).toContain("Looking for old notes");

        activePath = "notes/other.md";
        resolveRecall();
        await Promise.resolve();
        await Promise.resolve();

        expect(runQuietRecall).toHaveBeenCalledTimes(1);
        expect(bubbleView.close).toHaveBeenCalledTimes(1);
        expect(shownContent(bubbleView).type).toBe("ready-empty");
    });

    it("deduplicates repeated Bubble Discover clicks while recall is in flight", async () => {
        const runQuietRecall = jest.fn(() => new Promise<Awaited<ReturnType<PageletHost["runQuietRecall"]>>>(() => undefined));
        const coordinator = makeCoordinator(() => [], { runQuietRecall });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        await Promise.resolve();
        const ready = shownContent(bubbleView);
        ready.actions[0].callback();
        ready.actions[0].callback();

        expect(runQuietRecall).toHaveBeenCalledTimes(1);
        expect(shownContent(bubbleView).findings[0]?.text).toContain("Looking for old notes");
    });

    it("does not publish a Discover result after the Bubble is closed and reopened", async () => {
        let resolveRecall = (): void => undefined;
        const runQuietRecall = jest.fn(() => new Promise<Awaited<ReturnType<PageletHost["runQuietRecall"]>>>((resolve) => {
            resolveRecall = () => resolve({
                generatedAt: "2026-07-05T12:00:00.000Z",
                currentPath: "notes/current.md",
                totalCount: 1,
                candidates: [{
                    id: "recall-alpha",
                    title: "Recall: Alpha",
                    summary: "Alpha may matter again.",
                    sourceRefs: [{ path: "notes/alpha.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
                    whyNow: ["Source appears near the current note in Memory search."],
                    nextAction: "Open it.",
                    relation: "related" as const,
                    score: 80,
                    generatedAt: "2026-07-05T12:00:00.000Z",
                }],
            });
        }));
        const coordinator = makeCoordinator(() => [], { runQuietRecall });
        const bubbleView = makeBubbleView();
        const petView = makePetView();

        coordinator.showBubble(bubbleView, petView);
        await Promise.resolve();
        shownContent(bubbleView).actions[0].callback();
        bubbleView.close();

        coordinator.showBubble(bubbleView, petView);
        await Promise.resolve();
        expect(shownContent(bubbleView).type).toBe("ready-empty");

        resolveRecall();
        await Promise.resolve();
        await Promise.resolve();

        expect(runQuietRecall).toHaveBeenCalledTimes(1);
        expect(shownContent(bubbleView).type).toBe("ready-empty");
        expect(JSON.stringify(shownContent(bubbleView))).not.toContain("Alpha may matter again");
    });

    it("runs Discover inside Bubble and renders high-quality Recall cards", async () => {
        const onSourceClick = jest.fn();
        const runQuietRecall = jest.fn(async () => ({
            generatedAt: "2026-07-05T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 3,
            candidates: [{
                id: "recall-alpha",
                title: "Recall: Alpha",
                summary: "Alpha may matter again.",
                sourceRefs: [{ path: "notes/alpha.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
                whyNow: ["Source appears near the current note in Memory search."],
                nextAction: "Open it.",
                relation: "related" as const,
                score: 80,
                generatedAt: "2026-07-05T12:00:00.000Z",
                evaluationProvenance: "ai" as const,
                evaluationFingerprint: "eval-recall-alpha",
            }, {
                id: "recall-weak",
                title: "Recall: Weak",
                summary: "Weak match.",
                sourceRefs: [{ path: "notes/weak.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
                whyNow: ["Weak signal."],
                nextAction: "Ignore.",
                relation: "far" as const,
                score: 40,
                generatedAt: "2026-07-05T12:00:00.000Z",
            }, {
                id: "recall-current",
                title: "Recall: Current",
                summary: "The current note backed this saved insight.",
                sourceRefs: [{ path: "notes/current.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
                whyNow: ["Source matches the note you are looking at."],
                nextAction: "Compare it.",
                relation: "current" as const,
                score: 90,
                generatedAt: "2026-07-05T12:00:00.000Z",
                evaluationProvenance: "ai" as const,
                evaluationFingerprint: "eval-recall-current",
            }],
            discoverCandidates: [{
                id: "recall-local-only",
                title: "Recall: Local candidate",
                summary: "LOCAL SUMMARY MUST NOT RENDER",
                sourceRefs: [{ path: "notes/local.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
                whyNow: ["LOCAL WHY NOW MUST NOT RENDER"],
                nextAction: "LOCAL NEXT ACTION MUST NOT RENDER",
                relation: "related" as const,
                score: 85,
                generatedAt: "2026-07-05T12:00:00.000Z",
                evaluationProvenance: "local" as const,
            }],
        }));
        const coordinator = makeCoordinator(() => [], { runQuietRecall }, { onSourceClick });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        await Promise.resolve();

        const ready = shownContent(bubbleView);
        expect(ready.type).toBe("ready-empty");
        ready.actions[0].callback();

        expect(shownContent(bubbleView).findings[0]?.text).toContain("Looking for old notes");
        await Promise.resolve();

        const content = shownContent(bubbleView);
        expect(content.type).toBe("recall-delivery");
        expect(content.cards).toHaveLength(2);
        expect(JSON.stringify(content)).toContain("Alpha may matter again.");
        expect(JSON.stringify(content)).toContain("Source appears near the current note in Memory search.");
        expect(JSON.stringify(content)).not.toContain("LOCAL WHY NOW MUST NOT RENDER");
        expect(JSON.stringify(content)).not.toContain("LOCAL SUMMARY MUST NOT RENDER");
        expect(content.cards?.[0]?.actions.map((action) => action.label))
            .toContain("Link");
        expect(content.cards?.[1]?.actions.map((action) => action.label))
            .not.toContain("Link");

        content.cards?.[0]?.actions[0].callback();
        expect(onSourceClick).toHaveBeenCalledWith("notes/alpha.md");
    });

    it("renders local-only Bubble Discover as one labeled clue without Recall stack or why-now", async () => {
        const onSourceClick = jest.fn();
        let preparationActive = false;
        const runQuietRecall = jest.fn(async () => ({
            generatedAt: "2026-07-05T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 0,
            candidates: [],
            discoverCandidates: [{
                id: "recall-local",
                title: "Recall: Local candidate",
                summary: "LOCAL SUMMARY MUST NOT RENDER",
                sourceRefs: [{ path: "notes/local.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
                whyNow: ["LOCAL WHY NOW MUST NOT RENDER"],
                nextAction: "LOCAL NEXT ACTION MUST NOT RENDER",
                relation: "related" as const,
                score: 85,
                generatedAt: "2026-07-05T12:00:00.000Z",
                evaluationProvenance: "local" as const,
            }],
        }));
        const coordinator = makeCoordinator(() => [], {
            runQuietRecall,
            getMemoryPreparationStatus: () => preparationActive
                ? { filesDone: 1, filesTotal: 2 }
                : null,
        }, { onSourceClick });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        await Promise.resolve();
        preparationActive = true;
        shownContent(bubbleView).actions[0].callback();
        await Promise.resolve();
        await Promise.resolve();

        const content = shownContent(bubbleView);
        expect(content.type).toBe("discovery");
        expect(content.cards).toBeUndefined();
        expect(content.inlineHint).toBeUndefined();
        expect(content.findings[0]?.text).toBe("Local related clue");
        expect(content.findings[1]).toEqual({
            text: "Related by local note signals.",
            sourceLink: "notes/local.md",
            sourceTitle: "local",
        });
        expect(JSON.stringify(content)).not.toContain("LOCAL WHY NOW MUST NOT RENDER");
        expect(JSON.stringify(content)).not.toContain("LOCAL SUMMARY MUST NOT RENDER");

        content.actions[0]?.callback();
        expect(onSourceClick).toHaveBeenCalledWith("notes/local.md");
    });

    it("hides proactive Quiet Recall Link when no distinct source exists", () => {
        const candidate = {
            id: "recall-current",
            title: "Recall: Current",
            summary: "The current note backed this saved insight.",
            sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" as const }],
            whyNow: ["Source matches the note you are looking at."],
            nextAction: "Compare it.",
            relation: "current" as const,
            score: 90,
            generatedAt: "2026-07-05T12:00:00.000Z",
            evaluationProvenance: "ai" as const,
            evaluationFingerprint: "eval-recall-current",
        };
        const nudge = {
            candidateId: candidate.id,
            currentPath: "notes/current.md",
            relation: candidate.relation,
            generatedAt: candidate.generatedAt,
        };
        const onQuietRecallLink = jest.fn();
        const coordinator = makeCoordinator(() => [], {
            settings: {
                pagelet: {
                    enabled: true,
                    onboardingShown: true,
                    proactiveHints: true,
                    quietAcknowledged: false,
                },
                quietRecall: {
                    enabled: true,
                    bubbleNudgesEnabled: true,
                    quietRecallMode: "on",
                },
            } as PageletHost["settings"],
        }, {
            getQuietRecallNudge: () => nudge,
            getQuietRecallCandidate: () => candidate,
            onQuietRecallLink,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());

        const content = shownContent(bubbleView);
        expect(content.type).toBe("recall-delivery");
        expect(content.actions.map((action) => action.label)).not.toContain("Link");
        expect(onQuietRecallLink).not.toHaveBeenCalled();
    });
});
