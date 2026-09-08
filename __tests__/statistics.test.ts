import { describe, expect, it, jest } from "@jest/globals";
import type { EffectCallback, ReactElement, SetStateAction } from "react";
import type { App } from "obsidian";
import type { PluginManager } from "../src/plugin";
import { pluginT } from "../src/locales/plugin";
import Statistics, {
    getDefaultStatsRange,
    getStatisticsEmptyStateMessage,
    getStatisticsIssueMessage,
    selectRangeDays,
    shouldShowDevicesMetric,
} from "../src/components/Statistics";

jest.mock("obsidian");

// Run the component's real handlers with persistent hooks, without loading a chart or browser.
let mockHooks: StatisticsRenderer;
jest.mock("react", () => ({
    ...jest.requireActual<typeof import("react")>("react"),
    useState: <T>(initial: T | (() => T)) => mockHooks.useState(initial),
    useRef: <T>(initial: T) => mockHooks.useRef(initial),
    useEffect: (effect: EffectCallback, deps?: readonly unknown[]) => mockHooks.useEffect(effect, deps),
    useMemo: <T>(factory: () => T) => factory(),
}));

type ElementNode = ReactElement<{
    children?: unknown;
    role?: string;
    className?: string;
    onClick?: () => void;
    "aria-selected"?: boolean;
}>;

function elements(tree: unknown): ElementNode[] {
    if (Array.isArray(tree)) return tree.flatMap(elements);
    if (tree === null || typeof tree !== "object" || !("props" in tree)) return [];
    const node = tree as ElementNode;
    return [node, ...elements(node.props.children)];
}

function treeText(tree: unknown): string {
    if (typeof tree === "string" || typeof tree === "number") return String(tree);
    if (Array.isArray(tree)) return tree.map(treeText).join("");
    if (tree === null || typeof tree !== "object" || !("props" in tree)) return "";
    return treeText((tree as ElementNode).props.children);
}

class StatisticsRenderer {
    private cells: unknown[] = [];
    private cursor = 0;
    private effects: Array<{ deps?: readonly unknown[]; cleanup?: () => void }> = [];
    private pendingEffects: Array<() => void> = [];
    updates = 0;
    tree: unknown;

    constructor(readonly plugin: PluginManager) {
        this.render();
    }

    useState<T>(initial: T | (() => T)): [T, (next: SetStateAction<T>) => void] {
        const index = this.cursor++;
        if (!(index in this.cells)) {
            this.cells[index] = typeof initial === "function" ? (initial as () => T)() : initial;
        }
        return [this.cells[index] as T, (next) => {
            this.updates += 1;
            this.cells[index] = typeof next === "function"
                ? (next as (old: T) => T)(this.cells[index] as T) : next;
        }];
    }

    useRef<T>(initial: T): { current: T } {
        const index = this.cursor++;
        if (!(index in this.cells)) this.cells[index] = { current: initial };
        return this.cells[index] as { current: T };
    }

    useEffect(effect: EffectCallback, deps?: readonly unknown[]): void {
        const index = this.cursor++;
        const previous = this.effects[index];
        if (previous && deps && previous.deps?.length === deps.length
            && deps.every((value, key) => Object.is(value, previous.deps?.[key]))) return;
        this.pendingEffects.push(() => {
            previous?.cleanup?.();
            const cleanup = effect();
            this.effects[index] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
        });
    }

    render(): void {
        mockHooks = this;
        this.cursor = 0;
        this.tree = Statistics({
            app: { vault: { getName: () => "Test vault" } } as unknown as App,
            plugin: this.plugin,
            dashboardData: { version: 2, generatedAt: "2026-09-08T00:00:00.000Z", deviceId: "test", days: [], errors: [] },
        });
        this.pendingEffects.splice(0).forEach((effect) => effect());
    }

    unmount(): void {
        this.effects.forEach((effect) => effect.cleanup?.());
        this.tree = null;
    }

    select(label: string): void {
        const tab = elements(this.tree).find((node) => node.props.role === "tab" && treeText(node) === label);
        expect(tab).toBeDefined();
        tab?.props.onClick?.();
        this.render();
    }

    selected(): string | undefined {
        const tab = elements(this.tree).find((node) => node.props.role === "tab" && node.props["aria-selected"]);
        return tab ? treeText(tab) : undefined;
    }

    status(): string {
        return treeText(elements(this.tree).find((node) => node.props.role === "status"));
    }

    retry(): void {
        const retry = elements(this.tree).find((node) => node.props.className?.includes("pa-statistics-retry"));
        expect(retry).toBeDefined();
        retry?.props.onClick?.();
        this.render();
    }
}

function makePlugin(view = "overview") {
    const saveSettings = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const plugin = {
        settings: { statisticsType: view, statisticsSyncEnabled: false, animation: false },
        saveSettings,
        log: jest.fn(),
    } as unknown as PluginManager;
    return { plugin, saveSettings };
}

function pendingSave() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

async function settle(renderer: StatisticsRenderer): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    renderer.render();
}

describe("statistics dashboard helpers", () => {
    it("defaults compact containers to 30 days and wider containers to 90 days", () => {
        expect(getDefaultStatsRange(320)).toBe("30d");
        expect(getDefaultStatsRange(480)).toBe("30d");
        expect(getDefaultStatsRange(481)).toBe("90d");
        expect(getDefaultStatsRange(1024)).toBe("90d");
    });

    it("selects ranged chart days without trimming the all view", () => {
        const days = Array.from({ length: 100 }, (_, index) => index + 1);

        expect(selectRangeDays(days, "30d")).toEqual(days.slice(-30));
        expect(selectRangeDays(days, "90d")).toEqual(days.slice(-90));
        expect(selectRangeDays(days, "all")).toEqual(days);
    });

    it("shows device metrics only when sync has multi-device data", () => {
        expect(shouldShowDevicesMetric(false, 3)).toBe(false);
        expect(shouldShowDevicesMetric(true, 0)).toBe(false);
        expect(shouldShowDevicesMetric(true, 1)).toBe(false);
        expect(shouldShowDevicesMetric(true, 2)).toBe(true);
    });

    it("uses low-noise issue copy without storage internals", () => {
        expect(getStatisticsIssueMessage(0)).toBeNull();
        expect(getStatisticsIssueMessage(1)).toBe("1 Statistics history issue needs attention. Some writing history could not be loaded, so this view may be incomplete. Your notes are not affected.");
        expect(getStatisticsIssueMessage(2)).toBe("2 Statistics history issues need attention. Some writing history could not be loaded, so this view may be incomplete. Your notes are not affected.");
        expect(getStatisticsIssueMessage(2)).not.toMatch(/file|v2|shard|indexeddb|deviceid|jsonl/i);
    });

    it("distinguishes unavailable history from normal first use", () => {
        expect(getStatisticsEmptyStateMessage(0)).toBe("No statistics yet.");
        expect(getStatisticsEmptyStateMessage(1)).toBe("Statistics history is unavailable right now. Your notes are not affected.");
    });
});

describe("statistics view preference", () => {
    const saving = () => pluginT("plugin.statistics.view.saving", "en");
    const saveFailed = () => pluginT("plugin.statistics.view.saveFailed", "en");

    it("keeps an existing choice and reopens the view saved from the existing tabs", async () => {
        const { plugin, saveSettings } = makePlugin("growth");
        let storedView = plugin.settings.statisticsType;
        saveSettings.mockImplementation(async () => { storedView = plugin.settings.statisticsType; });
        const renderer = new StatisticsRenderer(plugin);
        expect(renderer.selected()).toBe("Growth");
        expect(saveSettings).not.toHaveBeenCalled();

        renderer.select("Daily");
        expect(renderer.selected()).toBe("Daily");
        expect(renderer.status()).toBe(saving());
        await settle(renderer);
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(renderer.status()).toBe("");
        renderer.unmount();

        const reopened = new StatisticsRenderer(makePlugin(storedView).plugin);
        expect(reopened.selected()).toBe("Daily");
        reopened.unmount();
    });

    it("keeps the selected view on failure and retries its save in place", async () => {
        const { plugin, saveSettings } = makePlugin();
        const retry = pendingSave();
        saveSettings.mockRejectedValueOnce(new Error("storage unavailable")).mockReturnValueOnce(retry.promise);
        const renderer = new StatisticsRenderer(plugin);
        renderer.select("Composition");
        await settle(renderer);

        expect(renderer.selected()).toBe("Composition");
        expect(plugin.settings.statisticsType).toBe("composition");
        expect(renderer.status()).toBe(saveFailed());
        expect(plugin.log).toHaveBeenCalledTimes(1);
        renderer.retry();
        expect(renderer.status()).toBe(saving());
        expect(renderer.selected()).toBe("Composition");
        expect(saveSettings).toHaveBeenCalledTimes(2);

        retry.resolve();
        await settle(renderer);
        expect(renderer.status()).toBe("");
        expect(renderer.selected()).toBe("Composition");
        renderer.unmount();
    });

    it("ignores a late failure from an older switch after the new choice saves", async () => {
        const { plugin, saveSettings } = makePlugin();
        const older = pendingSave();
        const newer = pendingSave();
        saveSettings.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        const renderer = new StatisticsRenderer(plugin);
        renderer.select("Daily");
        renderer.select("Growth");
        newer.resolve();
        await settle(renderer);
        older.reject(new Error("older save failed"));
        await settle(renderer);

        expect(renderer.selected()).toBe("Growth");
        expect(plugin.settings.statisticsType).toBe("growth");
        expect(renderer.status()).toBe("");
        renderer.unmount();
    });

    it("does not let an older success clear the latest save failure", async () => {
        const { plugin, saveSettings } = makePlugin();
        const older = pendingSave();
        saveSettings.mockReturnValueOnce(older.promise).mockRejectedValueOnce(new Error("latest save failed"));
        const renderer = new StatisticsRenderer(plugin);
        renderer.select("Daily");
        renderer.select("Growth");
        await settle(renderer);
        expect(renderer.status()).toBe(saveFailed());
        older.resolve();
        await settle(renderer);

        expect(renderer.selected()).toBe("Growth");
        expect(renderer.status()).toBe(saveFailed());
        renderer.unmount();
    });

    it.each(["resolve", "reject"] as const)("ignores a late %s after closing the component", async (result) => {
        const { plugin, saveSettings } = makePlugin();
        const pending = pendingSave();
        saveSettings.mockReturnValueOnce(pending.promise);
        const renderer = new StatisticsRenderer(plugin);
        renderer.select("Daily");
        expect(renderer.status()).toBe(saving());
        renderer.unmount();
        const updatesAtClose = renderer.updates;

        if (result === "resolve") pending.resolve();
        else pending.reject(new Error("closed save failed"));
        await Promise.resolve();
        await Promise.resolve();
        expect(renderer.updates).toBe(updatesAtClose);
        expect(renderer.tree).toBeNull();
    });
});
