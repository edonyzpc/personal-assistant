import { describe, expect, it, jest } from "@jest/globals";

import {
    BubbleCoordinator,
    INTENTIONALLY_QUIET_EXPLANATION_COPY_VERSION,
    NudgeOwner,
    READY_EMPTY_EXPLANATION_COPY_VERSION,
    type NudgeTicket,
} from "../src/pagelet/BubbleCoordinator";
import { quietRecallCandidateToDeliveryCandidate } from "../src/pagelet/bubble/recall-card";
import type { BubbleContent, DeliveryCandidate } from "../src/pagelet/bubble/types";
import type { BubbleView } from "../src/pagelet/bubble/BubbleView";
import type { PageletHost } from "../src/pagelet/PageletHost";
import type { PetView } from "../src/pagelet/pet/PetView";
import { ProactiveHints } from "../src/pagelet/hints/ProactiveHints";
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
    let currentContent: BubbleContent | null = null;
    const view = {
        bubbleState: "hidden",
        show: jest.fn((content: BubbleContent) => {
            currentContent = content;
            view.bubbleState = "visible";
        }),
        close: jest.fn(() => {
            currentContent = null;
            view.bubbleState = "hidden";
        }),
        isShowingContent: jest.fn((content: BubbleContent) => (
            view.bubbleState === "visible" && currentContent === content
        )),
    };
    return view as unknown as BubbleView;
}

function makePetView(): PetView {
    const stateMachine = {
        state: "idle",
        transition: jest.fn((event: string) => {
            if (event === "user-interact") stateMachine.state = "idle";
        }),
        forceState: jest.fn((state: string) => { stateMachine.state = state; }),
    };
    return {
        rootEl: {} as HTMLElement,
        stateMachine,
    } as unknown as PetView;
}

function makeNudgePetView(): PetView {
    const stateMachine = {
        state: "nudge",
        transition: jest.fn(() => { stateMachine.state = "idle"; }),
        forceState: jest.fn((state: string) => { stateMachine.state = state; }),
    };
    return {
        rootEl: {} as HTMLElement,
        stateMachine,
    } as unknown as PetView;
}

function makeQuietRecallFixture() {
    const candidate = {
        id: "recall-arbitration",
        title: "Recall: Current decision",
        summary: "An older decision is relevant again.",
        sourceRefs: [{ path: "notes/older.md", evidenceStrength: "medium" as const }],
        whyNow: ["It directly informs the note currently open."],
        nextAction: "Open the source when useful.",
        relation: "related" as const,
        score: 90,
        generatedAt: "2026-07-05T12:00:00.000Z",
        evaluationProvenance: "ai" as const,
        evaluationFingerprint: "eval-recall-arbitration",
    };
    return {
        candidate,
        nudge: {
            candidateId: candidate.id,
            currentPath: "notes/current.md",
            relation: candidate.relation,
            generatedAt: candidate.generatedAt,
        },
    };
}

function makeQuietRecallTicket(
    candidate: ReturnType<typeof makeQuietRecallFixture>["candidate"],
    nudge: ReturnType<typeof makeQuietRecallFixture>["nudge"],
): NudgeTicket {
    const deliveryCandidate = quietRecallCandidateToDeliveryCandidate(
        candidate,
        "en",
        nudge.currentPath,
    );
    if (!deliveryCandidate) throw new Error("expected delivery candidate");
    return {
        key: `${NudgeOwner.QuietRecall}:${candidate.evaluationFingerprint}`,
        owner: NudgeOwner.QuietRecall,
        candidate,
        deliveryCandidate,
        nudge,
    };
}

function makeRecapTicket(candidate: DeliveryCandidate & { kind: "recap" }): NudgeTicket {
    return {
        key: `${NudgeOwner.PreparedRecap}:${candidate.id}`,
        owner: NudgeOwner.PreparedRecap,
        candidate,
    };
}

function makeAgentInsightCandidate(): DeliveryCandidate & { kind: "review" } {
    return {
        id: "agent-insight-1",
        kind: "review",
        title: "Two project decisions now conflict",
        body: "The delivery decision and the older menu plan point in different directions.",
        sourceRefs: [
            { path: "Projects/Decision.md", title: "Decision" },
            { path: "Projects/Menu.md", title: "Menu" },
        ],
        whyNow: ["This became visible after the anchor note changed."],
        preparedAt: "2026-07-31T12:00:00.000Z",
        staleStatus: "fresh",
        route: { surface: "panel", payloadType: "agent-insight" },
        deliveryReceipt: {
            version: 1,
            kind: "review",
            fingerprint: "v1:review:0000000000000121",
        },
    };
}

function makeAgentInsightTicket(
    candidate: DeliveryCandidate & { kind: "review" },
): NudgeTicket {
    return {
        key: `${NudgeOwner.AgentInsight}:${candidate.id}`,
        owner: NudgeOwner.AgentInsight,
        candidate,
    };
}

function makePatternTicket(result: { generatedAt: string; totalCount: number; patterns: [] }): NudgeTicket {
    return {
        key: `${NudgeOwner.Pattern}:${result.generatedAt}`,
        owner: NudgeOwner.Pattern,
        result,
    };
}

function makeCoordinator(
    listReviewQueueItems: (filter?: ReviewQueueListFilter) => ReviewQueueItem[],
    hostOverrides: Partial<PageletHost> = {},
    overrides: Partial<ConstructorParameters<typeof BubbleCoordinator>[2]> = {},
    proactiveHints?: ProactiveHints,
): BubbleCoordinator {
    return new BubbleCoordinator(
        makeHost(listReviewQueueItems, hostOverrides),
        proactiveHints ?? new ProactiveHints({
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
            getAdmittedNudgeTickets: () => [],
            onPreparedRecapView: jest.fn(),
            onPreparedRecapLater: jest.fn(),
            onNudgePresented: jest.fn(),
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

async function flushAsyncWork(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
}

describe("BubbleCoordinator Review Queue reminders", () => {
    it("presents an admitted Agent insight through the shared nudge lifecycle", () => {
        const proactiveHints = new ProactiveHints({
            enabled: false,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
        const candidate = makeAgentInsightCandidate();
        const onAgentInsightView = jest.fn();
        const onAgentInsightLater = jest.fn();
        const onNudgePresented = jest.fn();
        const coordinator = makeCoordinator(() => [], {}, {
            getAgentInsightCandidate: () => candidate,
            getAdmittedNudgeTickets: () => [makeAgentInsightTicket(candidate)],
            onAgentInsightView,
            onAgentInsightLater,
            onNudgePresented,
        }, proactiveHints);
        const bubbleView = makeBubbleView();
        const petView = makeNudgePetView();

        coordinator.handlePetClick(bubbleView, petView);

        const content = shownContent(bubbleView);
        expect(content.type).toBe("review-delivery");
        expect(content.deliveryReceipt).toBe(candidate.deliveryReceipt);
        expect(onNudgePresented).toHaveBeenCalledWith(expect.objectContaining({
            owner: NudgeOwner.AgentInsight,
            candidate,
        }));
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(false);

        content.actions[0]?.callback();
        expect(onAgentInsightView).toHaveBeenCalledWith(candidate);
        expect(bubbleView.close).toHaveBeenCalledTimes(1);

        jest.mocked(bubbleView.close).mockClear();
        content.actions[1]?.callback();
        expect(onAgentInsightLater).toHaveBeenCalledWith(candidate);
        expect(bubbleView.close).toHaveBeenCalledTimes(1);
    });

    it("does not consume an Agent insight ticket when Bubble never becomes visible", () => {
        const proactiveHints = new ProactiveHints({
            enabled: false,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
        const candidate = makeAgentInsightCandidate();
        const onNudgePresented = jest.fn();
        const coordinator = makeCoordinator(() => [], {}, {
            getAdmittedNudgeTickets: () => [makeAgentInsightTicket(candidate)],
            onNudgePresented,
        }, proactiveHints);
        const bubbleView = {
            bubbleState: "hidden",
            show: jest.fn(),
            close: jest.fn(),
        } as unknown as BubbleView;
        const petView = makePetView();

        coordinator.reconcileNudge(bubbleView, petView);
        expect(coordinator.showNudgeBubble(bubbleView, petView)).toEqual({
            status: "not-visible",
        });

        expect(onNudgePresented).not.toHaveBeenCalled();
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
    });

    it.each([
        ["seen", false, 0, true],
        ["quiet hours", true, 0, false],
        ["shared cooldown", false, 60, false],
    ] as const)("keeps Agent insight proactive delivery gated by %s", (
        _label,
        quietHoursEnabled,
        cooldownMinutes,
        seen,
    ) => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
        try {
            const proactiveHints = new ProactiveHints({
                enabled: false,
                cooldownMinutes: 60,
                quietHours: quietHoursEnabled
                    ? { enabled: true, start: "00:00", end: "23:59" }
                    : { enabled: false, start: "22:00", end: "08:00" },
            });
            if (cooldownMinutes > 0) {
                expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
                proactiveHints.recordHintPresented();
            }
            const candidate = makeAgentInsightCandidate();
            const coordinator = makeCoordinator(() => [], {}, {
                getAdmittedNudgeTickets: () => [makeAgentInsightTicket(candidate)],
                isDeliverySeen: () => seen,
            }, proactiveHints);
            const bubbleView = makeBubbleView();
            const petView = makePetView();

            coordinator.reconcileNudge(bubbleView, petView);

            expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
            expect(coordinator.showNudgeBubble(bubbleView, petView)).toEqual({
                status: "unavailable",
            });
            coordinator.destroy();
        } finally {
            jest.useRealTimers();
        }
    });

    it("shows Quiet Recall before onboarding, then signals onboarding only after close", () => {
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        expect(proactiveHints.onInsightsReady()).toBe(true);
        const { candidate, nudge } = makeQuietRecallFixture();
        const onboarding = {
            kind: "quick_capture" as const,
            generatedAt: "2026-07-05T12:00:00.000Z",
        };
        const onNudgePresented = jest.fn();
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
            getOnboardingNudge: () => onboarding,
            getQuietRecallNudge: () => nudge,
            getQuietRecallCandidate: () => candidate,
            getAdmittedNudgeTickets: () => [
                makeQuietRecallTicket(candidate, nudge),
                {
                    key: `${NudgeOwner.Onboarding}:${onboarding.kind}:${onboarding.generatedAt}`,
                    owner: NudgeOwner.Onboarding,
                    nudge: onboarding,
                },
            ],
            onNudgePresented,
        }, proactiveHints);
        const bubbleView = makeBubbleView();
        const petView = makeNudgePetView();

        coordinator.handlePetClick(bubbleView, petView);

        expect(shownContent(bubbleView).type).toBe("recall-delivery");
        expect(proactiveHints.hasPendingHint).toBe(true);
        expect(onNudgePresented).toHaveBeenCalledWith(expect.objectContaining({
            owner: "quiet-recall",
        }));
        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();

        bubbleView.close();
        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
        coordinator.handleBubbleClosed(bubbleView, petView);
        expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(1);
        coordinator.handlePetClick(bubbleView, petView);

        expect(shownContent(bubbleView).type).toBe("nudge");
        expect(proactiveHints.hasPendingHint).toBe(false);
        expect(proactiveHints.onInsightsReady()).toBe(false);
        expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(1);
    });

    it("shows Prepared Recap on the shared clock before re-signalling Quiet Recall", () => {
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        expect(proactiveHints.onInsightsReady()).toBe(true);
        const { candidate, nudge } = makeQuietRecallFixture();
        const recap = {
            id: "recap-arbitration",
            kind: "recap" as const,
            title: "Projects/PA",
            body: "A high-value recap is ready.",
            sourceRefs: [{ path: "Projects/PA/A.md", title: "A" }],
            whyNow: ["A concrete cross-note insight is ready."],
            preparedAt: "2026-07-05T12:00:00.000Z",
            staleStatus: "fresh" as const,
            route: { surface: "tab" as const, payloadType: "scope-recap" },
        };
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
            getAdmittedNudgeTickets: () => [
                makeRecapTicket(recap),
                makeQuietRecallTicket(candidate, nudge),
            ],
        }, proactiveHints);
        const bubbleView = makeBubbleView();
        const petView = makeNudgePetView();

        coordinator.handlePetClick(bubbleView, petView);

        expect(shownContent(bubbleView).type).toBe("recap-delivery");
        expect(proactiveHints.hasPendingHint).toBe(false);
        expect(proactiveHints.onInsightsReady()).toBe(false);
        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();

        bubbleView.close();
        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
        coordinator.handleBubbleClosed(bubbleView, petView);
        expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(1);
        coordinator.handlePetClick(bubbleView, petView);

        expect(shownContent(bubbleView).type).toBe("recall-delivery");
        expect(proactiveHints.hasPendingHint).toBe(false);
        expect(proactiveHints.onInsightsReady()).toBe(false);
        expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(1);
    });

    it("lets Quiet Recall win when a generic payload exists without shared ownership", () => {
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        const { candidate, nudge } = makeQuietRecallFixture();
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
            getOnboardingNudge: () => ({
                kind: "quick_capture",
                generatedAt: "2026-07-05T12:00:00.000Z",
            }),
            getQuietRecallNudge: () => nudge,
            getQuietRecallCandidate: () => candidate,
            getAdmittedNudgeTickets: () => [makeQuietRecallTicket(candidate, nudge)],
        }, proactiveHints);
        const bubbleView = makeBubbleView();
        const petView = makeNudgePetView();

        coordinator.handlePetClick(bubbleView, petView);

        expect(shownContent(bubbleView).type).toBe("recall-delivery");
        expect(proactiveHints.hasPendingHint).toBe(false);
        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
    });

    it("keeps an existing Quiet Recall ticket ahead of a later Recap, then surfaces Recap", () => {
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        const { candidate, nudge } = makeQuietRecallFixture();
        let recap: (DeliveryCandidate & { kind: "recap" }) | null = null;
        const coordinator = makeCoordinator(() => [], {
            settings: {
                pagelet: { enabled: true, proactiveHints: true },
                quietRecall: { enabled: true, quietRecallMode: "on" },
            } as PageletHost["settings"],
        }, {
            getQuietRecallNudge: () => nudge,
            getQuietRecallCandidate: () => candidate,
            getAdmittedNudgeTickets: () => [
                makeQuietRecallTicket(candidate, nudge),
                ...(recap ? [makeRecapTicket(recap)] : []),
            ],
        }, proactiveHints);
        const bubbleView = makeBubbleView();
        const petView = makePetView();

        coordinator.reconcileNudge(bubbleView, petView);
        expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(1);
        recap = {
            id: "recap-deferred",
            kind: "recap",
            title: "Deferred recap",
            body: "This recap arrived after the existing ticket.",
            sourceRefs: [{ path: "notes/recap.md" }],
            whyNow: ["A high-value cross-note result is ready."],
            preparedAt: "2026-07-05T12:01:00.000Z",
            route: { surface: "tab", payloadType: "scope-recap" },
        };
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
        coordinator.reconcileNudge(bubbleView, petView);
        expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(1);

        coordinator.handlePetClick(bubbleView, petView);
        expect(shownContent(bubbleView).type).toBe("recall-delivery");

        bubbleView.close();
        coordinator.handleBubbleClosed(bubbleView, petView);
        expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(2);
        coordinator.handlePetClick(bubbleView, petView);
        expect(shownContent(bubbleView).type).toBe("recap-delivery");
    });

    it("holds a ticket during working and signals it once work settles", () => {
        const { candidate, nudge } = makeQuietRecallFixture();
        const coordinator = makeCoordinator(() => [], {
            settings: {
                pagelet: { enabled: true, proactiveHints: true },
                quietRecall: { enabled: true, quietRecallMode: "on" },
            } as PageletHost["settings"],
        }, {
            getQuietRecallNudge: () => nudge,
            getQuietRecallCandidate: () => candidate,
            getAdmittedNudgeTickets: () => [makeQuietRecallTicket(candidate, nudge)],
        });
        const bubbleView = makeBubbleView();
        const petView = makePetView();
        petView.stateMachine.forceState("working");
        jest.mocked(petView.stateMachine.forceState).mockClear();

        coordinator.reconcileNudge(bubbleView, petView);
        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();

        petView.stateMachine.forceState("idle");
        jest.mocked(petView.stateMachine.forceState).mockClear();
        coordinator.reconcileNudge(bubbleView, petView);
        expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(1);
        expect(petView.stateMachine.forceState).toHaveBeenCalledWith("nudge");
    });

    it("does not consume the shared clock when a queued Recap becomes stale", () => {
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
        let recap: (DeliveryCandidate & { kind: "recap" }) | null = {
            id: "recap-stale",
            kind: "recap",
            title: "Stale recap",
            body: "This should never render.",
            sourceRefs: [{ path: "notes/stale.md" }],
            whyNow: ["Was once current."],
            preparedAt: "2026-07-05T12:00:00.000Z",
            route: { surface: "tab", payloadType: "scope-recap" },
        };
        const onNudgePresented = jest.fn();
        const coordinator = makeCoordinator(() => [], {}, {
            getAdmittedNudgeTickets: () => recap ? [makeRecapTicket(recap)] : [],
            onNudgePresented,
        }, proactiveHints);
        const bubbleView = makeBubbleView();
        const petView = makePetView();
        (coordinator as unknown as { memoryReadySnapshot: boolean }).memoryReadySnapshot = true;
        coordinator.reconcileNudge(bubbleView, petView);
        recap = null;

        coordinator.handlePetClick(bubbleView, petView);

        expect(bubbleView.show).toHaveBeenCalledTimes(1);
        expect(shownContent(bubbleView).type).toBe("ready-empty");
        expect(onNudgePresented).not.toHaveBeenCalled();
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
    });

    it("keeps a valid ticket signalled when Bubble.show does not become visible", () => {
        const { candidate, nudge } = makeQuietRecallFixture();
        const onNudgePresented = jest.fn();
        const coordinator = makeCoordinator(() => [], {
            settings: {
                pagelet: { enabled: true, proactiveHints: true },
                quietRecall: { enabled: true, quietRecallMode: "on" },
            } as PageletHost["settings"],
        }, {
            getQuietRecallNudge: () => nudge,
            getQuietRecallCandidate: () => candidate,
            getAdmittedNudgeTickets: () => [makeQuietRecallTicket(candidate, nudge)],
            onNudgePresented,
        });
        const bubbleView = {
            bubbleState: "hidden",
            show: jest.fn(),
            close: jest.fn(),
        } as unknown as BubbleView;
        const petView = makeNudgePetView();

        coordinator.handlePetClick(bubbleView, petView);

        expect(bubbleView.show).toHaveBeenCalledTimes(1);
        expect(onNudgePresented).not.toHaveBeenCalled();
        expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(1);
        expect(petView.stateMachine.forceState).toHaveBeenCalledWith("nudge");
    });

    it("does not re-nudge the same Quiet Recall evaluation when generatedAt changes", () => {
        const fixture = makeQuietRecallFixture();
        let candidate = { ...fixture.candidate };
        let nudge = { ...fixture.nudge };
        const onNudgePresented = jest.fn();
        const coordinator = makeCoordinator(() => [], {
            settings: {
                pagelet: { enabled: true, petVisible: true, proactiveHints: true },
                quietRecall: { enabled: true, quietRecallMode: "on" },
                focusMode: false,
            } as PageletHost["settings"],
        }, {
            getQuietRecallNudge: () => nudge,
            getQuietRecallCandidate: () => candidate,
            getAdmittedNudgeTickets: () => [makeQuietRecallTicket(candidate, nudge)],
            onNudgePresented,
        });
        const bubbleView = makeBubbleView();
        const petView = makePetView();

        coordinator.reconcileNudge(bubbleView, petView);
        coordinator.handlePetClick(bubbleView, petView);
        expect(onNudgePresented).toHaveBeenCalledTimes(1);

        bubbleView.close();
        coordinator.handleBubbleClosed(bubbleView, petView);
        jest.mocked(petView.stateMachine.forceState).mockClear();
        candidate = { ...candidate, generatedAt: "2026-07-05T12:05:00.000Z" };
        nudge = { ...nudge, generatedAt: "2026-07-05T12:05:00.000Z" };

        coordinator.reconcileNudge(bubbleView, petView);

        expect(petView.stateMachine.forceState).not.toHaveBeenCalledWith("nudge");
        expect(onNudgePresented).toHaveBeenCalledTimes(1);
    });

    it("wakes one deferred shared ticket at cooldown expiry and cancels cleanly", () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
        try {
            const proactiveHints = new ProactiveHints({
                enabled: true,
                cooldownMinutes: 60,
                quietHours: { enabled: false, start: "22:00", end: "08:00" },
            });
            expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
            const recap: DeliveryCandidate & { kind: "recap" } = {
                id: "recap-before-pattern",
                kind: "recap",
                title: "Recap before pattern",
                body: "The first shared ticket.",
                sourceRefs: [{ path: "notes/recap.md" }],
                whyNow: ["Ready now."],
                preparedAt: "2026-07-05T12:00:00.000Z",
                route: { surface: "tab", payloadType: "scope-recap" },
            };
            const pattern = {
                generatedAt: "2026-07-05T12:01:00.000Z",
                totalCount: 1,
                patterns: [],
            };
            const coordinator = makeCoordinator(() => [], {}, {
                getPatternDetectionNudge: () => pattern,
                getAdmittedNudgeTickets: () => [
                    makeRecapTicket(recap),
                    {
                        key: `${NudgeOwner.Pattern}:${pattern.generatedAt}`,
                        owner: NudgeOwner.Pattern,
                        result: pattern,
                    },
                ],
            }, proactiveHints);
            const bubbleView = makeBubbleView();
            const petView = makeNudgePetView();

            coordinator.handlePetClick(bubbleView, petView);
            expect(shownContent(bubbleView).type).toBe("recap-delivery");
            bubbleView.close();
            coordinator.handleBubbleClosed(bubbleView, petView);

            expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
            expect(jest.getTimerCount()).toBe(1);
            proactiveHints.updateConfig({ enabled: false });
            coordinator.reconcileNudge(bubbleView, petView);
            expect(jest.getTimerCount()).toBe(0);

            proactiveHints.updateConfig({ enabled: true });
            coordinator.reconcileNudge(bubbleView, petView);
            expect(jest.getTimerCount()).toBe(1);
            jest.advanceTimersByTime(60 * 60 * 1000);
            expect(petView.stateMachine.forceState).toHaveBeenCalledTimes(1);
            expect(petView.stateMachine.forceState).toHaveBeenCalledWith("nudge");

            coordinator.destroy();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it("never promotes raw Pattern or Onboarding payloads that failed admission", () => {
        jest.useFakeTimers();
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        expect(proactiveHints.onInsightsReady()).toBe(true);
        proactiveHints.recordHintPresented();
        const pattern = {
            generatedAt: "2026-07-05T12:01:00.000Z",
            totalCount: 1,
            patterns: [] as [],
        };
        const onboarding = {
            kind: "quick_capture" as const,
            generatedAt: "2026-07-05T12:02:00.000Z",
        };
        const coordinator = makeCoordinator(() => [], {}, {
            getPatternDetectionNudge: () => pattern,
            getOnboardingNudge: () => onboarding,
            getAdmittedNudgeTickets: () => [],
        }, proactiveHints);
        const bubbleView = makeBubbleView();
        const petView = makePetView();
        try {
            coordinator.reconcileNudge(bubbleView, petView);

            expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
            expect(jest.getTimerCount()).toBe(0);
            jest.advanceTimersByTime(60 * 60 * 1000);
            expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
        } finally {
            coordinator.destroy();
            jest.useRealTimers();
        }
    });

    it("presents an admitted Recap after generic pending was cleared and still advances cooldown", () => {
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
        proactiveHints.updateConfig({ enabled: false });
        expect(proactiveHints.hasPendingHint).toBe(false);
        const recap: DeliveryCandidate & { kind: "recap" } = {
            id: "recap-survives-generic-off",
            kind: "recap",
            title: "Independent recap",
            body: "This Recap was admitted before generic hints were disabled.",
            sourceRefs: [{ path: "notes/recap.md" }],
            whyNow: ["Ready now."],
            preparedAt: "2026-07-05T12:00:00.000Z",
            route: { surface: "tab", payloadType: "scope-recap" },
        };
        const coordinator = makeCoordinator(() => [], {}, {
            getAdmittedNudgeTickets: () => [makeRecapTicket(recap)],
        }, proactiveHints);
        const bubbleView = makeBubbleView();

        coordinator.handlePetClick(bubbleView, makeNudgePetView());

        expect(shownContent(bubbleView).type).toBe("recap-delivery");
        proactiveHints.updateConfig({ enabled: true });
        expect(proactiveHints.onInsightsReady()).toBe(false);
    });

    it("cancels a deferred wake without touching a destroyed Pet state machine", () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
        const recap: DeliveryCandidate & { kind: "recap" } = {
            id: "recap-before-hide",
            kind: "recap",
            title: "Recap before hide",
            body: "First shared ticket.",
            sourceRefs: [{ path: "notes/recap.md" }],
            whyNow: ["Ready now."],
            preparedAt: "2026-07-05T12:00:00.000Z",
            route: { surface: "tab", payloadType: "scope-recap" },
        };
        const pattern = {
            generatedAt: "2026-07-05T12:01:00.000Z",
            totalCount: 1,
            patterns: [] as [],
        };
        const coordinator = makeCoordinator(() => [], {}, {
            getAdmittedNudgeTickets: () => [makeRecapTicket(recap), makePatternTicket(pattern)],
        }, proactiveHints);
        const bubbleView = makeBubbleView();
        const petView = makeNudgePetView();
        try {
            coordinator.handlePetClick(bubbleView, petView);
            bubbleView.close();
            coordinator.handleBubbleClosed(bubbleView, petView);
            expect(jest.getTimerCount()).toBe(1);
            jest.mocked(petView.stateMachine.forceState).mockClear();

            coordinator.reconcileNudge(bubbleView, null);
            jest.advanceTimersByTime(60 * 60 * 1000);

            expect(jest.getTimerCount()).toBe(0);
            expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
        } finally {
            coordinator.destroy();
            jest.useRealTimers();
        }
    });

    it("clears a live nudge and its wake timer while Focus Mode is active", () => {
        const settings = {
            pagelet: { enabled: true, petVisible: true, proactiveHints: true },
            quietRecall: { enabled: true, quietRecallMode: "on" },
            focusMode: false,
        } as PageletHost["settings"];
        const pattern = {
            generatedAt: "2026-07-05T12:01:00.000Z",
            totalCount: 1,
            patterns: [] as [],
        };
        const coordinator = makeCoordinator(() => [], { settings }, {
            getAdmittedNudgeTickets: () => [makePatternTicket(pattern)],
        });
        const bubbleView = makeBubbleView();
        const petView = makePetView();
        coordinator.reconcileNudge(bubbleView, petView);
        expect(petView.stateMachine.forceState).toHaveBeenLastCalledWith("nudge");

        settings.focusMode = true;
        coordinator.reconcileNudge(bubbleView, petView);

        expect(petView.stateMachine.forceState).toHaveBeenLastCalledWith("idle");
    });

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
        await flushAsyncWork();

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

    it("repaints a stale ready-empty bubble when Memory becomes unavailable", async () => {
        const coordinator = makeCoordinator(() => [], {
            isMemoryReadyForPageletDiscovery: async () => false,
        });
        (coordinator as unknown as { memoryReadySnapshot: boolean }).memoryReadySnapshot = true;
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        expect(shownContent(bubbleView).type).toBe("ready-empty");
        await flushAsyncWork();

        expect(shownContent(bubbleView).type).toBe("needs-setup");
        const show = bubbleView.show as unknown as jest.Mock;
        expect(show).toHaveBeenCalledTimes(2);
        expect(show.mock.calls[1]?.[2]).toEqual({ preserveFocus: true });
    });

    it("does not let readiness refresh replace a delivery that just became visible and seen", async () => {
        let resolveReady: ((ready: boolean) => void) | undefined;
        const readiness = new Promise<boolean>((resolve) => {
            resolveReady = resolve;
        });
        let seen = false;
        const recap: DeliveryCandidate & { kind: "recap" } = {
            id: "recap-readiness-race",
            kind: "recap",
            title: "A current recap",
            body: "This delivery must remain visible.",
            sourceRefs: [{ path: "notes/recap.md" }],
            whyNow: ["It just became visible."],
            preparedAt: "2026-07-27T12:00:00.000Z",
            route: { surface: "tab", payloadType: "scope-recap" },
            deliveryReceipt: {
                version: 1,
                kind: "recap",
                fingerprint: "v1:recap:0000000000000121",
            },
        };
        const coordinator = makeCoordinator(() => [], {
            isMemoryReadyForPageletDiscovery: () => readiness,
        }, {
            getPreparedRecapCandidate: () => seen ? null : recap,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        expect(shownContent(bubbleView).type).toBe("recap-delivery");

        // BubbleView's visibility receipt makes the candidate ineligible for
        // future proactive delivery, but must not evict this current surface.
        seen = true;
        resolveReady?.(true);
        await Promise.resolve();
        await Promise.resolve();

        expect(bubbleView.show).toHaveBeenCalledTimes(1);
        expect(shownContent(bubbleView).type).toBe("recap-delivery");
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
        expect(content.findings[0]).toEqual(expect.objectContaining({
            text: "The scope has a prepared recap.",
            sourceLink: "Projects/PA/A.md",
            sourceTitle: "Projects/PA · A",
        }));
        expect(JSON.stringify(content)).not.toContain("Generate summary");
        expect(content.actions.map((action) => action.label)).toEqual(["View recap", "Later"]);

        content.actions[0].callback();
        expect(onPreparedRecapView).toHaveBeenCalledWith(candidate);
    });

    it("shows a prepared Recap from the nudge path only when its high-value nudge is pending", () => {
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 30,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        proactiveHints.onInsightsReady();
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
            getAdmittedNudgeTickets: () => [makeRecapTicket(candidate)],
        }, proactiveHints);
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

    it("closes Bubble and routes Discover through the unified callback without running Quiet Recall", async () => {
        const runQuietRecall = jest.fn(async () => ({
            generatedAt: "2026-07-05T12:00:00.000Z",
            totalCount: 0,
            candidates: [],
        }));
        const onDiscoverConnections = jest.fn();
        const coordinator = makeCoordinator(() => [], { runQuietRecall }, {
            onDiscoverConnections,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());
        await flushAsyncWork();
        shownContent(bubbleView).actions[0].callback();

        expect(bubbleView.close).toHaveBeenCalledTimes(1);
        expect(bubbleView.bubbleState).toBe("hidden");
        expect(onDiscoverConnections).toHaveBeenCalledTimes(1);
        expect(runQuietRecall).not.toHaveBeenCalled();
    });

    it("keeps proactive Quiet Recall to View, Later, and Dismiss even with a distinct source", () => {
        const candidate = {
            id: "recall-related",
            title: "Recall: Related",
            summary: "An older note may matter again.",
            sourceRefs: [{ path: "notes/older.md", evidenceStrength: "medium" as const }],
            whyNow: ["Source matches the topic you are writing about."],
            nextAction: "Compare it.",
            relation: "related" as const,
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
        const onQuietRecallView = jest.fn();
        const onQuietRecallLink = jest.fn();
        const onQuietRecallLater = jest.fn();
        const onQuietRecallDismiss = jest.fn();
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
            getOnboardingNudge: () => ({
                kind: "quick_capture",
                generatedAt: "2026-07-05T11:59:00.000Z",
            }),
            getQuietRecallNudge: () => nudge,
            getQuietRecallCandidate: () => candidate,
            onQuietRecallView,
            onQuietRecallLink,
            onQuietRecallLater,
            onQuietRecallDismiss,
        });
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());

        const content = shownContent(bubbleView);
        expect(content.type).toBe("recall-delivery");
        expect(content.actions.map((action) => action.label)).toEqual([
            "View",
            "Later",
            "Dismiss",
        ]);

        content.actions[0].callback();
        expect(bubbleView.close).toHaveBeenCalledTimes(1);

        jest.mocked(bubbleView.close).mockClear();
        content.actions[1].callback();
        expect(bubbleView.close).not.toHaveBeenCalled();

        content.actions[2].callback();
        expect(bubbleView.close).toHaveBeenCalledTimes(1);

        expect(onQuietRecallView).toHaveBeenCalledWith(nudge);
        expect(onQuietRecallLater).toHaveBeenCalledWith(nudge);
        expect(onQuietRecallDismiss).toHaveBeenCalledWith(nudge);
        expect(onQuietRecallLink).not.toHaveBeenCalled();
    });

    it("filters seen Recall/Recap tickets and the default Recall Bubble", () => {
        const { candidate, nudge } = makeQuietRecallFixture();
        const recap = {
            id: "recap-seen",
            kind: "recap" as const,
            title: "Projects/PA",
            body: "Already delivered.",
            sourceRefs: [{ path: "Projects/PA/A.md" }],
            whyNow: ["The recap was already visible."],
            preparedAt: "2026-07-27T12:00:00.000Z",
            route: { surface: "tab" as const, payloadType: "scope-recap" },
            deliveryReceipt: {
                version: 1 as const,
                kind: "recap" as const,
                fingerprint: "v1:recap:0000000000000001",
            },
        };
        const coordinator = makeCoordinator(() => [], {
            settings: {
                pagelet: {
                    enabled: true,
                    petVisible: true,
                    onboardingShown: true,
                    proactiveHints: true,
                    quietAcknowledged: false,
                    scopeRecapHighValueHints: true,
                },
                quietRecall: {
                    enabled: true,
                    bubbleNudgesEnabled: true,
                    quietRecallMode: "on",
                },
            } as PageletHost["settings"],
        }, {
            getQuietRecallCandidate: () => candidate,
            getQuietRecallNudge: () => nudge,
            getAdmittedNudgeTickets: () => [
                makeRecapTicket(recap),
                makeQuietRecallTicket(candidate, nudge),
            ],
            isDeliverySeen: () => true,
        });
        (coordinator as unknown as { memoryReadySnapshot: boolean }).memoryReadySnapshot = true;
        const bubbleView = makeBubbleView();
        const petView = makePetView();

        coordinator.reconcileNudge(bubbleView, petView);
        coordinator.showBubble(bubbleView, petView);

        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
        expect(shownContent(bubbleView).type).toBe("ready-empty");
    });

    it.each([
        ["ready-empty", true, READY_EMPTY_EXPLANATION_COPY_VERSION],
        ["intentionally-quiet", false, INTENTIONALLY_QUIET_EXPLANATION_COPY_VERSION],
    ] as const)("acknowledges %s only after visible, then routes Pet short click to Ring", (
        kind,
        proactiveHints,
        copyVersion,
    ) => {
        const acknowledgements = new Set<string>();
        const onExplanationVisible = jest.fn((nextKind: string, nextVersion: string) => {
            acknowledgements.add(`${nextKind}:${nextVersion}`);
        });
        const updatePageletSetting = jest.fn();
        const coordinator = makeCoordinator(() => [], {
            updatePageletSetting,
            settings: {
                pagelet: {
                    enabled: true,
                    petVisible: true,
                    onboardingShown: true,
                    proactiveHints,
                    quietAcknowledged: true,
                },
                quietRecall: {
                    enabled: true,
                    bubbleNudgesEnabled: false,
                    quietRecallMode: "off",
                },
            } as PageletHost["settings"],
        }, {
            isExplanationAcknowledged: (nextKind, nextVersion) => (
                acknowledgements.has(`${nextKind}:${nextVersion}`)
            ),
            onExplanationVisible,
        });
        (coordinator as unknown as { memoryReadySnapshot: boolean }).memoryReadySnapshot = true;
        const failedBubble = {
            bubbleState: "hidden",
            show: jest.fn(),
            close: jest.fn(),
        } as unknown as BubbleView;
        const petView = Object.assign(makePetView(), {
            actionRingOpen: false,
            openActionRing: jest.fn(),
            closeActionRing: jest.fn(),
        });

        coordinator.handlePetClick(failedBubble, petView);
        expect(onExplanationVisible).not.toHaveBeenCalled();

        const visibleBubble = makeBubbleView();
        coordinator.handlePetClick(visibleBubble, petView);
        expect(shownContent(visibleBubble).type).toBe(kind);
        expect(onExplanationVisible).toHaveBeenCalledWith(kind, copyVersion);
        expect(updatePageletSetting).not.toHaveBeenCalled();

        visibleBubble.close();
        coordinator.handlePetClick(visibleBubble, petView);
        expect(petView.openActionRing).toHaveBeenCalledTimes(1);
    });

    it("keeps unseen delivery and setup explanations ahead of acknowledged-empty Ring", () => {
        const recap = {
            id: "recap-unseen",
            kind: "recap" as const,
            title: "Projects/PA",
            body: "A fresh recap.",
            sourceRefs: [{ path: "Projects/PA/A.md" }],
            whyNow: ["New source-backed value is ready."],
            preparedAt: "2026-07-27T12:00:00.000Z",
            route: { surface: "tab" as const, payloadType: "scope-recap" },
        };
        const acknowledged = () => true;
        const deliveryCoordinator = makeCoordinator(() => [], {}, {
            getPreparedRecapCandidate: () => recap,
            isExplanationAcknowledged: acknowledged,
        });
        (deliveryCoordinator as unknown as { memoryReadySnapshot: boolean }).memoryReadySnapshot = true;
        const deliveryBubble = makeBubbleView();
        const deliveryPet = Object.assign(makePetView(), {
            actionRingOpen: false,
            openActionRing: jest.fn(),
            closeActionRing: jest.fn(),
        });

        deliveryCoordinator.handlePetClick(deliveryBubble, deliveryPet);
        expect(shownContent(deliveryBubble).type).toBe("recap-delivery");
        expect(deliveryPet.openActionRing).not.toHaveBeenCalled();

        const setupCoordinator = makeCoordinator(() => [], {}, {
            isExplanationAcknowledged: acknowledged,
        });
        (setupCoordinator as unknown as { memoryReadySnapshot: boolean }).memoryReadySnapshot = false;
        const setupBubble = makeBubbleView();
        const setupPet = Object.assign(makePetView(), {
            actionRingOpen: false,
            openActionRing: jest.fn(),
            closeActionRing: jest.fn(),
        });

        setupCoordinator.handlePetClick(setupBubble, setupPet);
        expect(shownContent(setupBubble).type).toBe("needs-setup");
        expect(setupPet.openActionRing).not.toHaveBeenCalled();
    });

    it("keeps acknowledged Quick Review as terse Bubble instead of opening Ring", () => {
        const onExplanationVisible = jest.fn();
        const coordinator = makeCoordinator(() => [], {}, {
            isExplanationAcknowledged: (kind, version) => (
                kind === "ready-empty" && version === READY_EMPTY_EXPLANATION_COPY_VERSION
            ),
            onExplanationVisible,
        });
        (coordinator as unknown as { memoryReadySnapshot: boolean }).memoryReadySnapshot = true;
        const bubbleView = makeBubbleView();
        const petView = Object.assign(makePetView(), {
            actionRingOpen: false,
            openActionRing: jest.fn(),
            closeActionRing: jest.fn(),
        });

        coordinator.showBubble(bubbleView, petView, { entry: "quick-review" });

        expect(shownContent(bubbleView)).toEqual(expect.objectContaining({
            type: "ready-empty",
            findings: [expect.any(Object)],
        }));
        expect(petView.openActionRing).not.toHaveBeenCalled();
        expect(onExplanationVisible).not.toHaveBeenCalled();
    });

    it("keeps Quick Review in a terse Bubble when async readiness first resolves", async () => {
        const coordinator = makeCoordinator(() => [], {
            isMemoryReadyForPageletDiscovery: async () => true,
        }, {
            isExplanationAcknowledged: (kind, version) => (
                kind === "ready-empty" && version === READY_EMPTY_EXPLANATION_COPY_VERSION
            ),
        });
        const bubbleView = makeBubbleView();
        const petView = Object.assign(makePetView(), {
            actionRingOpen: false,
            openActionRing: jest.fn(),
            closeActionRing: jest.fn(),
        });

        coordinator.showBubble(bubbleView, petView, { entry: "quick-review" });
        expect(shownContent(bubbleView).type).toBe("needs-setup");

        await flushAsyncWork();

        expect(shownContent(bubbleView)).toEqual(expect.objectContaining({
            type: "ready-empty",
            findings: [expect.any(Object)],
        }));
        expect(petView.openActionRing).not.toHaveBeenCalled();
    });

    it("rechecks the latest Quick Review presentation queued behind a Pet readiness probe", async () => {
        let resolveFirst!: (ready: boolean) => void;
        const firstReadiness = new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
        });
        const isMemoryReadyForPageletDiscovery = jest.fn<() => Promise<boolean>>()
            .mockImplementationOnce(() => firstReadiness)
            .mockResolvedValue(true);
        const coordinator = makeCoordinator(() => [], {
            isMemoryReadyForPageletDiscovery,
        }, {
            isExplanationAcknowledged: (kind, version) => (
                kind === "ready-empty" && version === READY_EMPTY_EXPLANATION_COPY_VERSION
            ),
        });
        const bubbleView = makeBubbleView();
        const petView = Object.assign(makePetView(), {
            actionRingOpen: false,
            openActionRing: jest.fn(),
            closeActionRing: jest.fn(),
        });

        coordinator.showBubble(bubbleView, petView, { entry: "pet" });
        coordinator.showBubble(bubbleView, petView, { entry: "quick-review" });
        expect(shownContent(bubbleView).type).toBe("needs-setup");

        resolveFirst(true);
        await flushAsyncWork();

        expect(isMemoryReadyForPageletDiscovery).toHaveBeenCalledTimes(3);
        expect(shownContent(bubbleView)).toEqual(expect.objectContaining({
            type: "ready-empty",
            findings: [expect.any(Object)],
        }));
        expect(petView.openActionRing).not.toHaveBeenCalled();
    });

    it("does not consume the unseen Ready Empty explanation from an Intentionally Quiet Quick Review", () => {
        const acknowledgements = new Set([
            `intentionally-quiet:${INTENTIONALLY_QUIET_EXPLANATION_COPY_VERSION}`,
        ]);
        const onExplanationVisible = jest.fn((kind: string, version: string) => {
            acknowledgements.add(`${kind}:${version}`);
        });
        const settings = {
            pagelet: {
                enabled: true,
                petVisible: true,
                onboardingShown: true,
                proactiveHints: false,
                quietAcknowledged: true,
            },
            quietRecall: {
                enabled: true,
                bubbleNudgesEnabled: false,
                quietRecallMode: "off",
            },
        } as PageletHost["settings"];
        const coordinator = makeCoordinator(() => [], { settings }, {
            isExplanationAcknowledged: (kind, version) => (
                acknowledgements.has(`${kind}:${version}`)
            ),
            onExplanationVisible,
        });
        (coordinator as unknown as { memoryReadySnapshot: boolean }).memoryReadySnapshot = true;
        const bubbleView = makeBubbleView();
        const petView = Object.assign(makePetView(), {
            actionRingOpen: false,
            openActionRing: jest.fn(),
            closeActionRing: jest.fn(),
        });

        coordinator.showBubble(bubbleView, petView, { entry: "quick-review" });

        expect(shownContent(bubbleView)).toEqual(expect.objectContaining({
            type: "ready-empty",
            findings: [expect.any(Object)],
        }));
        expect(onExplanationVisible).not.toHaveBeenCalled();

        bubbleView.close();
        settings.pagelet.proactiveHints = true;
        coordinator.handlePetClick(bubbleView, petView);

        expect(shownContent(bubbleView)).toEqual(expect.objectContaining({
            type: "ready-empty",
            findings: [expect.any(Object), expect.any(Object)],
        }));
        expect(onExplanationVisible).toHaveBeenCalledWith(
            "ready-empty",
            READY_EMPTY_EXPLANATION_COPY_VERSION,
        );
    });

    it("keeps a pending ticket quiet while Ring is open and restores it after passive close", () => {
        const recap = {
            id: "recap-pending-ring",
            kind: "recap" as const,
            title: "Projects/PA",
            body: "Pending while the Ring is open.",
            sourceRefs: [{ path: "Projects/PA/A.md" }],
            whyNow: ["A fresh recap arrived."],
            preparedAt: "2026-07-27T12:00:00.000Z",
            route: { surface: "tab" as const, payloadType: "scope-recap" },
        };
        const coordinator = makeCoordinator(() => [], {
            settings: {
                pagelet: {
                    enabled: true,
                    petVisible: true,
                    onboardingShown: true,
                    proactiveHints: true,
                    quietAcknowledged: false,
                    scopeRecapHighValueHints: true,
                },
                quietRecall: { enabled: true, bubbleNudgesEnabled: false },
            } as PageletHost["settings"],
        }, {
            getAdmittedNudgeTickets: () => [makeRecapTicket(recap)],
        });
        const bubbleView = makeBubbleView();
        const petView = Object.assign(makePetView(), {
            actionRingOpen: true,
            openActionRing: jest.fn(),
            closeActionRing: jest.fn(),
        });

        coordinator.reconcileNudge(bubbleView, petView);
        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();

        petView.actionRingOpen = false;
        coordinator.reconcileNudge(bubbleView, petView);
        expect(petView.stateMachine.forceState).toHaveBeenCalledWith("nudge");

        coordinator.handlePetClick(bubbleView, petView);
        expect(shownContent(bubbleView).type).toBe("recap-delivery");
    });
});
