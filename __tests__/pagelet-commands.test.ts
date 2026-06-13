import {
    PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID,
    PAGELET_OPEN_PANEL_COMMAND_ID,
    PAGELET_PRELOAD_STATUS_LEGACY_COMMAND_ID,
    PAGELET_REVIEW_CURRENT_COMMAND_ID,
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
        onReviewCurrent: jest.fn(),
        onQuickReview: jest.fn(),
        onDiscoverConnections: jest.fn(),
        onPeriodicSummary: jest.fn(),
        onToggleProactiveHints: jest.fn(),
        onShowBackgroundPreparationStatus: jest.fn(),
        onMovePetCorner: jest.fn(),
        onTogglePetVisibility: jest.fn(),
    };
}

describe("registerPageletCommands", () => {
    it("registers final Pagelet open/review/status commands", () => {
        const host = makeHost();
        const callbacks = makeCallbacks();

        registerPageletCommands(host, callbacks);

        expect(host.registered.map((command) => command.id)).toEqual(expect.arrayContaining([
            PAGELET_OPEN_PANEL_COMMAND_ID,
            PAGELET_REVIEW_CURRENT_COMMAND_ID,
            PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID,
            PAGELET_PRELOAD_STATUS_LEGACY_COMMAND_ID,
        ]));
    });

    it("dispatches commands to the provided callbacks", () => {
        const host = makeHost();
        const callbacks = makeCallbacks();

        registerPageletCommands(host, callbacks);
        host.registered.find((command) => command.id === PAGELET_OPEN_PANEL_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_REVIEW_CURRENT_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_BACKGROUND_PREPARATION_STATUS_COMMAND_ID)?.callback();
        host.registered.find((command) => command.id === PAGELET_PRELOAD_STATUS_LEGACY_COMMAND_ID)?.callback();

        expect(callbacks.onOpenPanel).toHaveBeenCalledTimes(1);
        expect(callbacks.onReviewCurrent).toHaveBeenCalledTimes(1);
        expect(callbacks.onShowBackgroundPreparationStatus).toHaveBeenCalledTimes(2);
    });
});
