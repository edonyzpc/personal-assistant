import { describe, expect, it, jest } from "@jest/globals";

import type { PluginsUpdater } from "../src/plugin-manifest";
import type { ThemeUpdater } from "../src/theme-manifest";
import { createPluginUpdaterAction, createThemeUpdaterAction } from "../src/plugin/update-actions";

function createPluginUpdater(update: jest.Mock<() => Promise<void>>) {
    return { update } as unknown as PluginsUpdater;
}

function createThemeUpdater(update: jest.Mock<() => Promise<void>>) {
    return { update } as unknown as ThemeUpdater;
}

describe("plugin update action", () => {
    it("does not construct an updater until the action runs, then awaits update", async () => {
        let resolveUpdate!: () => void;
        const update = jest.fn<() => Promise<void>>(() => new Promise<void>((resolve) => {
            resolveUpdate = resolve;
        }));
        const createUpdater = jest.fn(() => createPluginUpdater(update));
        const action = createPluginUpdaterAction(createUpdater);

        expect(createUpdater).not.toHaveBeenCalled();

        const running = action();
        const settled = jest.fn();
        void running.then(settled);
        await Promise.resolve();
        await Promise.resolve();

        expect(createUpdater).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        expect(settled).not.toHaveBeenCalled();

        resolveUpdate();
        await expect(running).resolves.toBeUndefined();
        expect(settled).toHaveBeenCalledTimes(1);
    });

    it("constructs a fresh updater for each invocation and propagates update rejection", async () => {
        const failure = new Error("plugin update failed");
        const update = jest.fn<() => Promise<void>>()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(failure);
        const createUpdater = jest.fn(() => createPluginUpdater(update));
        const action = createPluginUpdaterAction(createUpdater);

        await expect(action()).resolves.toBeUndefined();
        await expect(action()).rejects.toBe(failure);

        expect(createUpdater).toHaveBeenCalledTimes(2);
        expect(update).toHaveBeenCalledTimes(2);
    });

    it("propagates updater construction failure without calling update", async () => {
        const failure = new Error("plugin updater construction failed");
        const update = jest.fn<() => Promise<void>>();
        const createUpdater = jest.fn(() => {
            throw failure;
        });

        await expect(createPluginUpdaterAction(createUpdater)()).rejects.toBe(failure);
        expect(update).not.toHaveBeenCalled();
    });
});

describe("theme update action", () => {
    it("does not initialize an updater until the action runs, then awaits update", async () => {
        let resolveUpdate!: () => void;
        const update = jest.fn<() => Promise<void>>(() => new Promise<void>((resolve) => {
            resolveUpdate = resolve;
        }));
        const createUpdater = jest.fn(async () => createThemeUpdater(update));
        const action = createThemeUpdaterAction(createUpdater);

        expect(createUpdater).not.toHaveBeenCalled();

        const running = action();
        const settled = jest.fn();
        void running.then(settled);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(createUpdater).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
        expect(settled).not.toHaveBeenCalled();

        resolveUpdate();
        await expect(running).resolves.toBeUndefined();
        expect(settled).toHaveBeenCalledTimes(1);
    });

    it("initializes a fresh updater for each invocation and propagates update rejection", async () => {
        const failure = new Error("theme update failed");
        const update = jest.fn<() => Promise<void>>()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(failure);
        const createUpdater = jest.fn(async () => createThemeUpdater(update));
        const action = createThemeUpdaterAction(createUpdater);

        await expect(action()).resolves.toBeUndefined();
        await expect(action()).rejects.toBe(failure);

        expect(createUpdater).toHaveBeenCalledTimes(2);
        expect(update).toHaveBeenCalledTimes(2);
    });

    it("propagates ThemeUpdater.init rejection", async () => {
        const failure = new Error("theme init failed");
        const createUpdater = jest.fn<() => Promise<ThemeUpdater>>(async () => {
            throw failure;
        });

        await expect(createThemeUpdaterAction(createUpdater)()).rejects.toBe(failure);
        expect(createUpdater).toHaveBeenCalledTimes(1);
    });
});
