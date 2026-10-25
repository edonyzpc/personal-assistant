import {
    PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID,
    PAGELET_DISCOVER_COMMAND_ID,
    PAGELET_GRAPH_DISCOVERY_COMMAND_ID,
    PAGELET_MAINTENANCE_REVIEW_COMMAND_ID,
    PAGELET_OPEN_PANEL_COMMAND_ID,
    PAGELET_MOVE_PET_COMMAND_ID,
    PAGELET_TOGGLE_HINTS_COMMAND_ID,
    PAGELET_TOGGLE_PET_COMMAND_ID,
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
        onDiscoverConnections: jest.fn(),
        onMaintenanceReview: jest.fn(),
        onGraphDiscovery: jest.fn(),
        onToggleProactiveHints: jest.fn(),
        onShowBackgroundPreparationStatus: jest.fn(),
        onMovePetCorner: jest.fn(),
        onTogglePetVisibility: jest.fn(),
    };
}

describe("registerPageletCommands", () => {
    it("registers current Pagelet commands without retired aliases or duplicate names", () => {
        const host = makeHost();
        const callbacks = makeCallbacks();

        registerPageletCommands(host, callbacks);

        expect(host.registered.map((command) => command.id)).toEqual(expect.arrayContaining([
            PAGELET_OPEN_PANEL_COMMAND_ID,
            PAGELET_DISCOVER_COMMAND_ID,
            PAGELET_MAINTENANCE_REVIEW_COMMAND_ID,
            PAGELET_GRAPH_DISCOVERY_COMMAND_ID,
            PAGELET_TOGGLE_HINTS_COMMAND_ID,
            PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID,
            PAGELET_MOVE_PET_COMMAND_ID,
            PAGELET_TOGGLE_PET_COMMAND_ID,
        ]));
        const registeredIds = host.registered.map((command) => command.id);
        for (const retiredId of [
            "pa-pagelet:open-prepared-review",
            "pa-pagelet:review-current",
            "pa-pagelet:quick-review",
            "pa-pagelet:quiet-recall",
            "pa-pagelet:scope-recap",
            "pa-pagelet:preload-status",
            "pa-pagelet:clear-scope-recap-cache",
            "pa-pagelet:weekly-review",
            "pa-pagelet:periodic-summary",
        ]) {
            expect(registeredIds).not.toContain(retiredId);
        }

        expect(new Set(host.registered.map((command) => command.id)).size).toBe(host.registered.length);
        expect(new Set(host.registered.map((command) => command.name)).size).toBe(host.registered.length);
    });

    it("dispatches commands to the provided callbacks", () => {
        const host = makeHost();
        const callbacks = makeCallbacks();

        registerPageletCommands(host, callbacks);
        host.registered.find((command) => command.id === PAGELET_OPEN_PANEL_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_DISCOVER_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_MAINTENANCE_REVIEW_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_GRAPH_DISCOVERY_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_TOGGLE_HINTS_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_MOVE_PET_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_TOGGLE_PET_COMMAND_ID)?.callback();

        expect(callbacks.onOpenPanel).toHaveBeenCalledTimes(1);
        expect(callbacks.onDiscoverConnections).toHaveBeenCalledTimes(1);
        expect(callbacks.onMaintenanceReview).toHaveBeenCalledTimes(1);
        expect(callbacks.onGraphDiscovery).toHaveBeenCalledTimes(1);
        expect(callbacks.onToggleProactiveHints).toHaveBeenCalledTimes(1);
        expect(callbacks.onShowBackgroundPreparationStatus).toHaveBeenCalledTimes(1);
        expect(callbacks.onMovePetCorner).toHaveBeenCalledTimes(1);
        expect(callbacks.onTogglePetVisibility).toHaveBeenCalledTimes(1);
    });

    it("registers the canonical discovery command with localized production copy", () => {
        const englishHost = makeHost();
        const chineseHost = makeHost();

        registerPageletCommands(englishHost, makeCallbacks(), "en");
        registerPageletCommands(chineseHost, makeCallbacks(), "zh");

        expect(englishHost.registered.find(
            (command) => command.id === PAGELET_DISCOVER_COMMAND_ID,
        )?.name).toBe("Pagelet: Discover connections");
        expect(chineseHost.registered.find(
            (command) => command.id === PAGELET_DISCOVER_COMMAND_ID,
        )?.name).toBe("拾页：发现关联");
    });
});
