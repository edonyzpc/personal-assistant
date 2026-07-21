import { jest } from '@jest/globals';

interface MockNoticeEl {
    addClass: () => void;
    parentElement?: { addClass: () => void };
    setCssStyles: (styles?: Record<string, string>) => void;
    createEl: () => MockNoticeEl;
    querySelector: () => MockNoticeEl | null;
}

export const noticeMessages: Array<{ message?: unknown; timeout?: number }> = [];

export class Notice {
    static messages = noticeMessages;

    constructor(message?: unknown, timeout?: number) {
        noticeMessages.push({ message, timeout });
    }
    hide() { }
    noticeEl: MockNoticeEl = {
        addClass: () => { },
        parentElement: { addClass: () => { } },
        setCssStyles: () => { },
        createEl: () => this.noticeEl,
        querySelector: () => null,
    };
    messageEl = this.noticeEl;
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

export class Component {
    private registeredCallbacks: Array<() => unknown> = [];

    load() { }
    onload() { }
    unload() {
        for (const callback of this.registeredCallbacks.splice(0)) {
            callback();
        }
    }
    onunload() { }
    addChild<T extends Component>(component: T) { return component; }
    removeChild<T extends Component>(component: T) { return component; }
    register(cb: () => unknown) {
        this.registeredCallbacks.push(cb);
    }
    registerEvent(_eventRef: unknown) { }
    registerDomEvent(el: unknown, event: string, handler: unknown, options?: unknown) {
        if (el && typeof (el as HTMLElement).addEventListener === "function") {
            (el as HTMLElement).addEventListener(event, handler as EventListener, options as AddEventListenerOptions | undefined);
        }
    }
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

export class PluginSettingTab {
    app: App;
    plugin: unknown;
    containerEl = {
        empty: jest.fn(),
        createEl: jest.fn(() => ({
            appendChild: jest.fn(),
            setAttr: jest.fn(),
        })),
    };

    constructor(app: App, plugin: unknown) {
        this.app = app;
        this.plugin = plugin;
    }

    display() { }
}

export class MarkdownView {
    editor: unknown;
    file?: TFile | null;

    constructor(editor?: unknown, file?: TFile | null) {
        this.editor = editor;
        this.file = file;
    }

    getMode() {
        return 'source';
    }
}

export class ItemView extends Component {
    app: App;
    containerEl: HTMLElement;

    constructor(leaf: { app?: App; containerEl?: HTMLElement } = {}) {
        super();
        this.app = leaf.app ?? new App();
        this.containerEl = leaf.containerEl ?? {} as HTMLElement;
    }

    getViewType() {
        return '';
    }

    getDisplayText() {
        return '';
    }

    getIcon() {
        return '';
    }

    async onOpen() { }
    async onClose() { }
    registerEvent(_eventRef: unknown) { }
}

export const MarkdownRenderer = {
    render: jest.fn((_app: unknown, markdown: string, el: { setText?: (text: string) => void; textContent?: string }) => {
        if (typeof el.setText === 'function') {
            el.setText(markdown);
        } else {
            el.textContent = markdown;
        }
    }),
};

export const setIcon = jest.fn();
export const addIcon = jest.fn();

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
    getLeavesOfType: jest.Mock;
    getActiveViewOfType: jest.Mock;
    getActiveFile: jest.Mock;
    setActiveLeaf: jest.Mock;
    openLinkText: jest.Mock;
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
    secretStorage = {
        setSecret: jest.fn(),
        getSecret: jest.fn(() => null),
        listSecrets: jest.fn(() => []),
    };
    metadataCache = { getCache: jest.fn() };
    workspace: MockWorkspace = {
        getLeaf: jest.fn(),
        getMostRecentLeaf: jest.fn(),
        getLeavesOfType: jest.fn(() => []),
        getActiveViewOfType: jest.fn(() => null),
        getActiveFile: jest.fn(() => null),
        setActiveLeaf: jest.fn(),
        openLinkText: jest.fn(async () => undefined),
        on: jest.fn(),
    };
}

export const requestUrl: jest.Mock = jest.fn(async () => ({ arrayBuffer: new ArrayBuffer(0) }));
export const normalizePath = (p: string) => p;
export const moment = () => ({
    format: (format: string) => format === 'YYYY-MM-DD' ? '2026-05-18' : '',
});
export const getFrontMatterInfo = (markdown: string) => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    if (!match) return { exists: false, contentStart: 0, frontmatter: '', from: 0, to: 0 };
    return {
        exists: true,
        contentStart: match[0].length,
        frontmatter: match[1] ?? '',
        from: 4,
        to: 4 + (match[1]?.length ?? 0),
    };
};
export const parseYaml = (yaml: string): Record<string, unknown> => Object.fromEntries(yaml
    .split(/\r?\n/)
    .flatMap((line): Array<[string, unknown]> => {
        const match = /^\s*([^:#]+):\s*(.*?)\s*$/.exec(line);
        if (!match) return [];
        const key = match[1]!.trim();
        const raw = match[2]!.trim();
        if (raw === 'true') return [[key, true]];
        if (raw === 'false') return [[key, false]];
        if (raw.startsWith('[') && raw.endsWith(']')) {
            return [[key, raw.slice(1, -1).split(',').map((part) => part.trim())]];
        }
        return [[key, raw.replace(/^['"]|['"]$/g, '')]];
    }));
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

export class TAbstractFile {
    path: string;
    name: string;

    constructor(path = "") {
        this.path = path;
        this.name = path.split("/").pop() ?? path;
    }
}

export class TFile extends TAbstractFile {
    stat: { mtime: number; ctime: number; size?: number };
    extension: string;
    basename: string;

    constructor(
        path = "",
        stat: { mtime?: number; ctime?: number; size?: number } = {},
        extension?: string,
        name?: string,
    ) {
        super(path);
        this.name = name ?? this.name;
        this.extension = extension ?? this.name.split(".").pop() ?? "";
        this.basename = this.name.endsWith(`.${this.extension}`)
            ? this.name.slice(0, -this.extension.length - 1)
            : this.name;
        this.stat = {
            mtime: stat.mtime ?? 0,
            ctime: stat.ctime ?? 0,
            ...(stat.size === undefined ? {} : { size: stat.size }),
        };
    }
}
