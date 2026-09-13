import { describe, expect, it, jest } from "@jest/globals";

import {
    BubbleCoordinator,
    INTENTIONALLY_QUIET_EXPLANATION_COPY_VERSION,
    NudgeOwner,
    READY_EMPTY_EXPLANATION_COPY_VERSION,
    type NudgeTicket,
} from "../src/pagelet/BubbleCoordinator";
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
            getPatternDetectionNudge: () => null,
            onPatternDetectionView: jest.fn(),
            onPatternDetectionDismiss: jest.fn(),
            getAdmittedNudgeTickets: () => [],
            onNudgePresented: jest.fn(),
            ...overrides,
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

    it("wakes one deferred shared Pattern ticket at cooldown expiry and cancels cleanly", () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
        try {
            const proactiveHints = new ProactiveHints({
                enabled: true,
                cooldownMinutes: 60,
                quietHours: { enabled: false, start: "22:00", end: "08:00" },
            });
            expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
            const first = {
                generatedAt: "2026-07-31T12:00:00.000Z",
                totalCount: 1,
                patterns: [] as [],
            };
            const second = {
                ...first,
                generatedAt: "2026-07-31T12:01:00.000Z",
            };
            const coordinator = makeCoordinator(() => [], {}, {
                getAdmittedNudgeTickets: () => [
                    makePatternTicket(first),
                    makePatternTicket(second),
                ],
            }, proactiveHints);
            const bubbleView = makeBubbleView();
            const petView = makeNudgePetView();

            coordinator.handlePetClick(bubbleView, petView);
            expect(shownContent(bubbleView).type).toBe("nudge");
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

    it("cancels a deferred Agent insight wake without touching a destroyed Pet state machine", () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
        const proactiveHints = new ProactiveHints({
            enabled: true,
            cooldownMinutes: 60,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        });
        expect(proactiveHints.onInsightsReady({ enabled: true })).toBe(true);
        const candidate = makeAgentInsightCandidate();
        const pattern = {
            generatedAt: "2026-07-31T12:01:00.000Z",
            totalCount: 1,
            patterns: [] as [],
        };
        const coordinator = makeCoordinator(() => [], {}, {
            getAdmittedNudgeTickets: () => [
                makeAgentInsightTicket(candidate),
                makePatternTicket(pattern),
            ],
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

    it("keeps a pending Agent insight quiet while Ring is open and restores it after passive close", () => {
        const candidate = makeAgentInsightCandidate();
        const coordinator = makeCoordinator(() => [], {}, {
            getAdmittedNudgeTickets: () => [makeAgentInsightTicket(candidate)],
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
        expect(shownContent(bubbleView).type).toBe("review-delivery");
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


});
