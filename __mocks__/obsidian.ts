import { jest } from '@jest/globals';

interface MockNoticeEl {
    addClass: () => void;
    parentElement?: { addClass: () => void };
    setCssStyles: (styles?: Record<string, string>) => void;
}

export class Notice {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_msg?: unknown, _timeout?: number) { }
    hide() { }
    noticeEl: MockNoticeEl = {
        addClass: () => { },
        parentElement: { addClass: () => { } },
        setCssStyles: () => { },
    };
}

type MockAdapter = {
    write: jest.Mock;
    read: jest.Mock;
    exists: jest.Mock;
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

export type TFile = { path: string; stat?: { mtime: number; ctime: number; size?: number }; extension?: string; name?: string };
export type TAbstractFile = TFile;
