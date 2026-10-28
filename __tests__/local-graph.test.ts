import { describe, expect, it, jest } from '@jest/globals';
import type { App, WorkspaceLeaf } from 'obsidian';

jest.mock('obsidian', () => ({
    Notice: jest.fn(),
    Platform: { isDesktop: false, isMobile: false },
    normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/'),
}));

import { LocalGraph, type LocalGraphHost } from '../src/local-graph';
import { ViewResize, ViewType } from '../src/view';

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
            },
            enableGraphColors: false,
            colorGroups: [pluginColorGroup],
        },
        log: jest.fn(),
    } as LocalGraphHost;

    return {
        app,
        plugin,
        adapter,
        localGraph: new LocalGraph(app, plugin),
        localGraphLeaf,
        openLocalGraph,
    };
};

function createHoverTarget(viewport: { width: number; height: number }, containsGraph = true) {
    const styles: Record<string, string> = {};
    const cssProperties: Record<string, string> = {};
    const classes: string[] = [];
    const target = {
        isConnected: true,
        querySelector: jest.fn((selector: string) => (
            containsGraph && selector.includes('localgraph') ? { tagName: 'div' } : null
        )),
        ownerDocument: {
            defaultView: {
                innerWidth: viewport.width,
                innerHeight: viewport.height,
            },
        },
        setCssStyles: jest.fn((next: Record<string, string>) => Object.assign(styles, next)),
        setCssProps: jest.fn((next: Record<string, string>) => Object.assign(cssProperties, next)),
        addClass: jest.fn((value: string) => classes.push(value)),
    };
    return { target, styles, cssProperties, classes };
}

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

    it('applies saved display choices to all open graphs while preserving each view state and resize state', async () => {
        const { app, plugin, localGraph, adapter, openLocalGraph } = createHarness();
        plugin.settings.localGraph.depth = 9;
        plugin.settings.localGraph.showTags = false;
        plugin.settings.localGraph.collapse = true;
        plugin.settings.localGraph.autoColors = true;
        localGraph.resized = true;
        const states = [0.4, 1.7].map((scale, index) => Object.freeze({
            type: 'localgraph', active: index === 0, pinned: true,
            state: Object.freeze({ file: `${index}.md`, customState: { keep: true },
                options: Object.freeze({ scale, showArrow: false, colorGroups: ['existing'],
                    customOption: { value: index }, localJumps: 1 }) }),
        }));
        const leaves = states.map((state) => ({ getViewState: () => state,
            setViewState: jest.fn<(value: unknown) => Promise<void>>(async () => undefined) }));
        jest.spyOn(app.workspace, 'getLeavesOfType').mockReturnValue(leaves as unknown as WorkspaceLeaf[]);

        await localGraph.applyOptionsToOpenGraphs();

        leaves.forEach((leaf, index) => {
            expect(leaf.setViewState).toHaveBeenCalledWith({ ...states[index], state: {
                ...states[index].state, options: { ...states[index].state.options,
                    localJumps: 9, showTags: false, showAttachments: true,
                    localInterlinks: true, close: true },
            } });
        });
        expect(localGraph.resized).toBe(true);
        expect(openLocalGraph).not.toHaveBeenCalled();
        expect(app.workspace.getLeaf).not.toHaveBeenCalled();
        expect(adapter.exists).not.toHaveBeenCalled();
        expect(adapter.read).not.toHaveBeenCalled();
    });

    it('explicitly applies enabled PA colors independently of autoColors, preserving order and alpha', async () => {
        const { plugin, localGraph, localGraphLeaf } = createHarness();
        plugin.settings.enableGraphColors = true;
        plugin.settings.localGraph.autoColors = false;
        plugin.settings.colorGroups = [
            { query: 'same', color: { a: 0.25, rgb: 100 } },
            { query: 'same', color: { a: 0.6, rgb: 200 } },
        ];

        await localGraph.applyOptionsToOpenGraphs();

        const applied = localGraphLeaf.setViewState.mock.calls[0][0] as { state: { options: Record<string, unknown> } };
        expect(applied.state.options.colorGroups).toEqual(plugin.settings.colorGroups);
        expect(applied.state.options.colorGroups).not.toBe(plugin.settings.colorGroups);
        expect(applied.state.options).not.toHaveProperty('scale');
        expect(applied.state.options).not.toHaveProperty('showArrow');
        expect(applied.state.options).not.toHaveProperty('type');
        expect(applied.state.options).not.toHaveProperty('resizeStyle');
    });

    it('does nothing when no local graph is open', async () => {
        const { app, localGraph, adapter, openLocalGraph } = createHarness();
        jest.spyOn(app.workspace, 'getLeavesOfType').mockReturnValue([]);

        await expect(localGraph.applyOptionsToOpenGraphs()).resolves.toBeUndefined();

        expect(openLocalGraph).not.toHaveBeenCalled();
        expect(adapter.exists).not.toHaveBeenCalled();
        expect(adapter.read).not.toHaveBeenCalled();
    });

    it('reports a leaf failure only after all other leaf updates settle', async () => {
        const { app, localGraph } = createHarness();
        let finish!: () => void;
        const pending = new Promise<void>((resolve) => { finish = resolve; });
        const failure = new Error('closed graph');
        const leaves = [
            { getViewState: () => ({ type: 'localgraph' }), setViewState: jest.fn(async () => { throw failure; }) },
            { getViewState: () => ({ type: 'localgraph' }), setViewState: jest.fn(() => pending) },
        ];
        jest.spyOn(app.workspace, 'getLeavesOfType').mockReturnValue(leaves as unknown as WorkspaceLeaf[]);
        const settled = jest.fn();
        const applying = localGraph.applyOptionsToOpenGraphs();
        void applying.then(settled, settled);
        await Promise.resolve();
        await Promise.resolve();

        expect(leaves[1].setViewState).toHaveBeenCalledTimes(1);
        expect(settled).not.toHaveBeenCalled();
        finish();
        await expect(applying).rejects.toBe(failure);
    });
});

describe('ViewResize', () => {
    it.each([
        [{ width: 1200, height: 900 }, { width: '550px', height: '500px', left: '325px', top: '200px' }],
        [{ width: 320, height: 420 }, { width: '288px', height: '388px', left: '16px', top: '16px' }],
        [{ width: 40, height: 50 }, { width: '36px', height: '45px', left: '2px', top: '2.5px' }],
    ])('fits a new hover graph to its owning %p viewport', async (viewport, expected) => {
        const { plugin } = createHarness();
        (plugin.settings.localGraph as unknown as { resizeStyle?: unknown }).resizeStyle = {
            width: 2400,
            height: 50,
        };
        const owner = new ViewResize(plugin, ViewType.LocalGraphView);
        const hover = createHoverTarget(viewport);

        await owner.resize(hover.target as unknown as HTMLElement);

        expect(hover.styles).toEqual(expect.objectContaining(expected));
        expect(hover.cssProperties).toEqual({ '--resize-popover-width': expected.width });
        expect(hover.classes).toContain('resize-popover-width');
        expect(owner.resized).toBe(true);
    });

    it('resizes each matching new target and leaves unrelated hovers untouched', async () => {
        const { plugin } = createHarness();
        const owner = new ViewResize(plugin, ViewType.LocalGraphView);
        const first = createHoverTarget({ width: 1200, height: 900 });
        const second = createHoverTarget({ width: 320, height: 420 });
        const unrelated = createHoverTarget({ width: 1200, height: 900 }, false);

        await owner.resize(first.target as unknown as HTMLElement);
        await owner.resize(second.target as unknown as HTMLElement);
        await owner.resize(unrelated.target as unknown as HTMLElement);

        expect(first.target.setCssStyles).toHaveBeenCalledTimes(1);
        expect(second.target.setCssStyles).toHaveBeenCalledWith(expect.objectContaining({
            width: '288px',
            height: '388px',
        }));
        expect(unrelated.target.setCssStyles).not.toHaveBeenCalled();
    });
});
