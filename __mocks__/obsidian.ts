import { jest } from '@jest/globals';

interface MockNoticeEl {
    addClass: () => void;
    parentElement?: { addClass: () => void };
    setCssStyles: (styles?: Record<string, string>) => void;
}

export class Notice {
    constructor(_msg?: unknown, _timeout?: number) { }
    hide() { }
    noticeEl: MockNoticeEl = {
        addClass: () => { },
        parentElement: { addClass: () => { } },
        setCssStyles: () => { },
    };
}

export class Modal {
    app: App;
    contentEl: HTMLElement;

    constructor(app: App) {
        this.app = app;
        this.contentEl = {} as HTMLElement;
    }

    open() { }
    close() { }
    onOpen() { }
    onClose() { }
}

export class Setting {
    constructor(_containerEl: unknown) { }
    setName(_name: string) { return this; }
    setDesc(_desc: string | DocumentFragment) { return this; }
    addButton(_callback: (button: {
        setCta: () => unknown;
        setButtonText: (text: string) => unknown;
        onClick: (callback: () => void) => unknown;
    }) => void) { return this; }
}

type MockAdapter = {
    write: jest.Mock;
    read: jest.Mock;
    exists: jest.Mock;
    list: jest.Mock;
    mkdir: jest.Mock;
    remove: jest.Mock;
};

type MockVault = {
    adapter: MockAdapter;
    getRoot: () => { path: string };
    getMarkdownFiles: () => TFile[];
};

type MockWorkspace = {
    getLeaf: jest.Mock;
    getMostRecentLeaf: jest.Mock;
    on: jest.Mock;
};

export class App {
    vault: MockVault = {
        adapter: {
            write: jest.fn(),
            read: jest.fn(),
            exists: jest.fn(),
            list: jest.fn(async () => ({ files: [], folders: [] })),
            mkdir: jest.fn(),
            remove: jest.fn(),
        },
        getRoot: () => ({ path: '' }),
        getMarkdownFiles: () => [],
    };
    metadataCache = { getCache: jest.fn() };
    workspace: MockWorkspace = { getLeaf: jest.fn(), getMostRecentLeaf: jest.fn(), on: jest.fn() };
}

export const requestUrl: jest.Mock = jest.fn(async () => ({ arrayBuffer: new ArrayBuffer(0) }));
export const normalizePath = (p: string) => p;
export const getFrontMatterInfo = () => ({ exists: false, contentStart: 0, frontmatter: '', from: 0, to: 0 });
export const Platform = { isDesktop: true, isMobile: false };
export function debounce<T extends unknown[], V>(cb: (...args: [...T]) => V, timeout = 0, resetTimer = true) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let latestArgs: T | null = null;

    const debounced = ((...args: [...T]) => {
        latestArgs = args;
        if (timer && resetTimer) {
            clearTimeout(timer);
            timer = null;
        }
        if (!timer) {
            timer = setTimeout(() => {
                timer = null;
                if (latestArgs) {
                    const argsToRun = latestArgs;
                    latestArgs = null;
                    cb(...argsToRun);
                }
            }, timeout);
        }
        return debounced;
    }) as ((...args: [...T]) => typeof debounced) & { cancel: () => typeof debounced; run: () => V | void };

    debounced.cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        latestArgs = null;
        return debounced;
    };
    debounced.run = () => {
        if (!timer || !latestArgs) return undefined;
        clearTimeout(timer);
        timer = null;
        const argsToRun = latestArgs;
        latestArgs = null;
        return cb(...argsToRun);
    };

    return debounced;
}

export type TFile = { path: string; stat?: { mtime: number; ctime: number; size?: number }; extension?: string; name?: string };
export type TAbstractFile = TFile;
