import {
    PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID,
    PAGELET_CLEAR_SCOPE_RECAP_CACHE_COMMAND_ID,
    PAGELET_GRAPH_DISCOVERY_COMMAND_ID,
    PAGELET_MAINTENANCE_REVIEW_COMMAND_ID,
    PAGELET_OPEN_PANEL_COMMAND_ID,
    PAGELET_OPEN_PREPARED_REVIEW_COMMAND_ID,
    PAGELET_PRELOAD_STATUS_LEGACY_COMMAND_ID,
    PAGELET_QUIET_RECALL_COMMAND_ID,
    PAGELET_REVIEW_CURRENT_COMMAND_ID,
    PAGELET_SCOPE_RECAP_COMMAND_ID,
    registerPageletCommands,
    type PageletCommandCallbacks,
} from "../src/pagelet/commands";

interface RegisteredCommand {
    id: string;
    name: string;
    callback: () => void;
}

function makeHost(): { registered: RegisteredCommand[]; addCommand: (command: RegisteredCommand) => void } {
    const registered: RegisteredCommand[] = [];
    return {
        registered,
        addCommand(command: RegisteredCommand): void {
            registered.push(command);
        },
    };
}

function makeCallbacks(): PageletCommandCallbacks {
    return {
        onOpenPanel: jest.fn(),
        onOpenPreparedReview: jest.fn(),
        onReviewCurrent: jest.fn(),
        onQuickReview: jest.fn(),
        onDiscoverConnections: jest.fn(),
        onMaintenanceReview: jest.fn(),
        onQuietRecall: jest.fn(),
        onGraphDiscovery: jest.fn(),
        onScopeRecap: jest.fn(),
        onClearScopeRecapCache: jest.fn(),
        onToggleProactiveHints: jest.fn(),
        onShowBackgroundPreparationStatus: jest.fn(),
        onMovePetCorner: jest.fn(),
        onTogglePetVisibility: jest.fn(),
    };
}

describe("registerPageletCommands", () => {
    it("registers final Pagelet open/review/status commands without duplicates", () => {
        const host = makeHost();
        const callbacks = makeCallbacks();

        registerPageletCommands(host, callbacks);

        expect(host.registered.map((command) => command.id)).toEqual(expect.arrayContaining([
            PAGELET_OPEN_PANEL_COMMAND_ID,
            PAGELET_OPEN_PREPARED_REVIEW_COMMAND_ID,
            PAGELET_REVIEW_CURRENT_COMMAND_ID,
            PAGELET_MAINTENANCE_REVIEW_COMMAND_ID,
            PAGELET_QUIET_RECALL_COMMAND_ID,
            PAGELET_GRAPH_DISCOVERY_COMMAND_ID,
            PAGELET_SCOPE_RECAP_COMMAND_ID,
            PAGELET_CLEAR_SCOPE_RECAP_CACHE_COMMAND_ID,
            PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID,
            PAGELET_PRELOAD_STATUS_LEGACY_COMMAND_ID,
        ]));
        expect(host.registered.map((command) => command.id)).not.toContain("pa-pagelet:weekly-review");
        expect(host.registered.map((command) => command.id)).not.toContain("pa-pagelet:periodic-summary");

        expect(new Set(host.registered.map((command) => command.id)).size).toBe(host.registered.length);
        expect(new Set(host.registered.map((command) => command.name)).size).toBe(host.registered.length);
    });

    it("dispatches commands to the provided callbacks", () => {
        const host = makeHost();
        const callbacks = makeCallbacks();

        registerPageletCommands(host, callbacks);
        host.registered.find((command) => command.id === PAGELET_OPEN_PANEL_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_OPEN_PREPARED_REVIEW_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_REVIEW_CURRENT_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_MAINTENANCE_REVIEW_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_QUIET_RECALL_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_GRAPH_DISCOVERY_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_SCOPE_RECAP_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_CLEAR_SCOPE_RECAP_CACHE_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_PRELOAD_STATUS_LEGACY_COMMAND_ID)?.callback();

        expect(callbacks.onOpenPanel).toHaveBeenCalledTimes(1);
        expect(callbacks.onOpenPreparedReview).toHaveBeenCalledTimes(1);
        expect(callbacks.onReviewCurrent).toHaveBeenCalledTimes(1);
        expect(callbacks.onMaintenanceReview).toHaveBeenCalledTimes(1);
        expect(callbacks.onQuietRecall).toHaveBeenCalledTimes(1);
        expect(callbacks.onGraphDiscovery).toHaveBeenCalledTimes(1);
        expect(callbacks.onScopeRecap).toHaveBeenCalledTimes(1);
        expect(callbacks.onClearScopeRecapCache).toHaveBeenCalledTimes(1);
        expect(callbacks.onShowBackgroundPreparationStatus).toHaveBeenCalledTimes(2);
    });

    it("registers the prepared review command with localized production copy", () => {
        const englishHost = makeHost();
        const chineseHost = makeHost();

        registerPageletCommands(englishHost, makeCallbacks(), "en");
        registerPageletCommands(chineseHost, makeCallbacks(), "zh");

        expect(englishHost.registered.find(
            (command) => command.id === PAGELET_OPEN_PREPARED_REVIEW_COMMAND_ID,
        )?.name).toBe("Pagelet: Open prepared review");
        expect(chineseHost.registered.find(
            (command) => command.id === PAGELET_OPEN_PREPARED_REVIEW_COMMAND_ID,
        )?.name).toBe("拾页：打开已准备的审阅");
    });
});
