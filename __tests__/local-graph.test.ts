import { describe, expect, it, jest } from '@jest/globals';
import type { App } from 'obsidian';

jest.mock('obsidian', () => ({
    Notice: jest.fn(),
    Platform: { isDesktop: false, isMobile: false },
    normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/'),
}));

import { LocalGraph } from '../src/local-graph';
import type { PluginManager } from '../src/plugin';

const pluginColorGroup = {
    query: 'path:/',
    color: {
        a: 1,
        rgb: 6617700,
    },
};

const createHarness = ({
    graphExists = false,
    graphConfig = JSON.stringify({ colorGroups: [] }),
}: {
    graphExists?: boolean;
    graphConfig?: string;
} = {}) => {
    const localGraphViewState = { type: 'localgraph', state: {} };
    const localGraphLeaf = {
        getViewState: jest.fn(() => localGraphViewState),
        setViewState: jest.fn<(viewState: unknown) => Promise<void>>(async () => undefined),
    };
    const openLocalGraph = jest.fn<(viewState: unknown) => Promise<void>>(async () => undefined);
    const adapter = {
        exists: jest.fn<(path: string) => Promise<boolean>>(async () => graphExists),
        read: jest.fn<(path: string) => Promise<string>>(async () => graphConfig),
    };
    const app = {
        vault: {
            configDir: '.obsidian',
            adapter,
        },
        workspace: {
            getActiveFile: jest.fn(() => ({ path: 'Note.md' })),
            getLeaf: jest.fn(() => ({ setViewState: openLocalGraph })),
            getLeavesOfType: jest.fn(() => [localGraphLeaf]),
        },
        commands: {
            executeCommandById: jest.fn(async () => true),
        },
    } as unknown as App;
    const plugin = {
        settings: {
            localGraph: {
                notice: 'show current note graph view',
                type: 'popover',
                depth: 2,
                showTags: true,
                showAttach: true,
                showNeighbor: true,
                collapse: false,
                autoColors: false,
                resizeStyle: {
                    width: 550,
                    height: 500,
                },
            },
            enableGraphColors: false,
            colorGroups: [pluginColorGroup],
        },
        log: jest.fn(),
    } as unknown as PluginManager;

    return {
        adapter,
        localGraph: new LocalGraph(app, plugin),
        localGraphLeaf,
        openLocalGraph,
    };
};

describe('LocalGraph', () => {
    it('opens a local graph when the vault has no global graph config yet', async () => {
        const { adapter, localGraph, localGraphLeaf, openLocalGraph } = createHarness();

        await expect(localGraph.startup()).resolves.toBeUndefined();

        expect(adapter.exists).toHaveBeenCalledWith('.obsidian/graph.json');
        expect(adapter.read).not.toHaveBeenCalled();
        expect(openLocalGraph).toHaveBeenCalledWith({
            type: 'localgraph',
            active: true,
            state: {
                file: 'Note.md',
            },
        });
        expect(localGraphLeaf.setViewState).toHaveBeenCalledWith(expect.objectContaining({
            state: expect.objectContaining({
                options: expect.objectContaining({
                    colorGroups: [],
                    localJumps: 2,
                    showTags: true,
                    showAttachments: true,
                    localInterlinks: true,
                    showArrow: true,
                    close: false,
                    scale: 1,
                }),
            }),
        }));
    });

    it('copies color groups from an existing global graph config', async () => {
        const globalColorGroup = {
            query: 'tag:#project',
            color: {
                a: 1,
                rgb: 123456,
            },
        };
        const { localGraph, localGraphLeaf } = createHarness({
            graphExists: true,
            graphConfig: JSON.stringify({ colorGroups: [globalColorGroup] }),
        });

        await localGraph.startup();

        expect(localGraphLeaf.setViewState).toHaveBeenCalledWith(expect.objectContaining({
            state: expect.objectContaining({
                options: expect.objectContaining({
                    colorGroups: [globalColorGroup],
                }),
            }),
        }));
    });

    it('falls back to empty color groups when global graph config is invalid JSON', async () => {
        const { localGraph, localGraphLeaf } = createHarness({
            graphExists: true,
            graphConfig: '{invalid-json',
        });

        await expect(localGraph.startup()).resolves.toBeUndefined();

        expect(localGraphLeaf.setViewState).toHaveBeenCalledWith(expect.objectContaining({
            state: expect.objectContaining({
                options: expect.objectContaining({
                    colorGroups: [],
                }),
            }),
        }));
    });

    it('updates local graph colors from plugin settings without requiring graph.json', async () => {
        const { adapter, localGraph, localGraphLeaf } = createHarness();

        await localGraph.updateGraphColors();

        expect(adapter.exists).not.toHaveBeenCalled();
        expect(adapter.read).not.toHaveBeenCalled();
        expect(localGraphLeaf.setViewState).toHaveBeenCalledWith(expect.objectContaining({
            state: expect.objectContaining({
                options: expect.objectContaining({
                    colorGroups: [pluginColorGroup],
                }),
            }),
        }));
    });
});
