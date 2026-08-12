import { PluginManager } from "../../src/plugin";
import { DEFAULT_SETTINGS } from "../../src/settings";

export interface PluginHarnessOptions {
    initialData?: Record<string, unknown> | null;
    secretStorageValues?: Record<string, string | null>;
    configDir?: string;
}

export interface PluginHarness {
    plugin: PluginManager;
    adapter: {
        read: jest.Mock;
        write: jest.Mock;
        copy: jest.Mock;
        remove: jest.Mock;
        process: jest.Mock;
    };
    secretStorage: {
        getSecret: jest.Mock;
        setSecret: jest.Mock;
    };
    readPersisted: () => Record<string, unknown> | null;
    writePersisted: (data: Record<string, unknown>) => void;
    beforeNextCopy: (callback: () => void) => void;
    beforeNextProcess: (callback: () => void) => void;
    beforeNextRead: (callback: () => void) => void;
}

export function createPluginHarness(options: PluginHarnessOptions = {}): PluginHarness {
    const { initialData = null, secretStorageValues = {}, configDir = ".obsidian" } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = Object.create(PluginManager.prototype) as any;
    let persistedText = initialData === null ? null : JSON.stringify(initialData);
    const temporaryFiles = new Map<string, string>();
    let beforeCopy: (() => void) | null = null;
    let beforeProcess: (() => void) | null = null;
    let beforeRead: (() => void) | null = null;

    const missingFileError = () => Object.assign(new Error("data.json is missing"), { code: "ENOENT" });
    const existingFileError = () => Object.assign(new Error("data.json already exists"), { code: "EEXIST" });

    const adapter = {
        read: jest.fn(async () => {
            const callback = beforeRead;
            beforeRead = null;
            callback?.();
            if (persistedText === null) throw missingFileError();
            return persistedText;
        }),
        write: jest.fn(async (path: string, data: string) => {
            temporaryFiles.set(path, data);
        }),
        copy: jest.fn(async (sourcePath: string, _destinationPath: string) => {
            beforeCopy?.();
            beforeCopy = null;
            if (persistedText !== null) throw existingFileError();
            const source = temporaryFiles.get(sourcePath);
            if (source === undefined) throw missingFileError();
            persistedText = source;
        }),
        remove: jest.fn(async (path: string) => {
            temporaryFiles.delete(path);
        }),
        process: jest.fn(async (_path: string, mutate: (data: string) => string) => {
            const callback = beforeProcess;
            beforeProcess = null;
            callback?.();
            if (persistedText === null) throw missingFileError();
            persistedText = mutate(persistedText);
            return persistedText;
        }),
    };

    const secrets = new Map<string, string | null>(Object.entries(secretStorageValues));
    const secretStorage = {
        getSecret: jest.fn((id: string) => secrets.get(id) ?? null),
        setSecret: jest.fn((id: string, value: string) => { secrets.set(id, value); }),
    };

    plugin.app = {
        vault: { configDir, adapter },
        secretStorage,
    };
    plugin.manifest = {
        id: "personal-assistant",
        dir: `${configDir}/plugins/personal-assistant`,
    };
    plugin.loadData = jest.fn(async () => (
        persistedText === null ? null : JSON.parse(persistedText)
    ));
    plugin.saveData = jest.fn(async (next: unknown) => {
        persistedText = JSON.stringify(next);
    });
    plugin.log = jest.fn();
    plugin.settingsSaveTail = null;
    plugin.settingsChangeListeners = new Set();
    plugin.settingsMigrationBaselineFingerprint = null;
    plugin.token = "";
    plugin.tokenCacheState = "unknown";
    plugin.unloading = false;
    plugin.settings = { ...DEFAULT_SETTINGS };

    return {
        plugin,
        adapter,
        secretStorage,
        readPersisted: () => persistedText === null ? null : JSON.parse(persistedText),
        writePersisted: (next) => { persistedText = JSON.stringify(next); },
        beforeNextCopy: (callback) => { beforeCopy = callback; },
        beforeNextProcess: (callback) => { beforeProcess = callback; },
        beforeNextRead: (callback) => { beforeRead = callback; },
    };
}
