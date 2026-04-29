import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { request } from 'obsidian';
import { PluginsUpdater } from '../src/plugin-manifest';

const mockProgressBarInstance = {
    show: jest.fn(),
    addDiv: jest.fn(),
    stepin: jest.fn(),
    updateProgress: jest.fn(),
    hide: jest.fn(),
};

jest.mock('obsidian', () => ({
    request: jest.fn(),
    normalizePath: (path: string) => path,
}));

jest.mock('../src/progress-bar', () => ({
    ProgressBar: jest.fn(() => mockProgressBarInstance),
}));

type MockRequest = jest.MockedFunction<typeof request>;
type ReleaseConfig = {
    tagName: string;
    mainJs?: string | null;
    manifest?: string | null;
    styles?: string | null;
};

const createUpdater = ({
    enabledPlugins = ['sample-plugin'],
    manifests = {
        'sample-plugin': { id: 'sample-plugin', version: '1.0.0' },
    },
    repos = {
        'sample-plugin': 'owner/sample-plugin',
    },
}: {
    enabledPlugins?: string[];
    manifests?: Record<string, { id: string; version: string }>;
    repos?: Record<string, string>;
} = {}) => {
    const adapter = {
        exists: jest.fn<(path: string) => Promise<boolean>>(async () => true),
        mkdir: jest.fn<(path: string) => Promise<void>>(async () => undefined),
        write: jest.fn<(path: string, data: string) => Promise<void>>(async () => undefined),
    };
    const enablePluginAndSave = jest.fn<(pluginID: string) => Promise<void>>(async () => undefined);
    const app = {
        plugins: {
            manifests,
            enabledPlugins: new Set(enabledPlugins),
            enablePluginAndSave,
        },
        vault: {
            configDir: '.obsidian',
            adapter,
        },
    };
    const plugin = {
        settings: {
            cachePluginRepo: repos,
        },
        saveSettings: jest.fn(async () => undefined),
        log: jest.fn(),
    };

    return {
        updater: new PluginsUpdater(app as any, plugin as any), // eslint-disable-line @typescript-eslint/no-explicit-any
        app,
        adapter,
        enablePluginAndSave,
        plugin,
    };
};

const mockReleaseRequests = ({
    releases = {
        'owner/sample-plugin': {
            tagName: '1.1.0',
            mainJs: 'main js',
            manifest: '{"id":"sample-plugin","version":"1.1.0"}',
            styles: 'styles',
        },
    },
    tagName,
    mainJs,
    manifest,
    styles,
}: {
    releases?: Record<string, ReleaseConfig>;
    tagName?: string;
    mainJs?: string | null;
    manifest?: string | null;
    styles?: string | null;
}) => {
    const releaseConfigs: Record<string, ReleaseConfig> = {
        ...releases,
    };
    if (tagName) {
        releaseConfigs['owner/sample-plugin'] = {
            tagName,
            mainJs: mainJs === undefined ? 'main js' : mainJs,
            manifest: manifest === undefined ? '{"id":"sample-plugin","version":"1.1.0"}' : manifest,
            styles: styles === undefined ? 'styles' : styles,
        };
    }
    const requestMock = request as MockRequest;
    requestMock.mockImplementation(async (requestParam) => {
        const url = typeof requestParam === 'string' ? requestParam : requestParam.url;
        const latestReleaseMatch = url.match(/^https:\/\/api\.github\.com\/repos\/(.+)\/releases\/latest$/);
        if (latestReleaseMatch) {
            const config = releaseConfigs[latestReleaseMatch[1]];
            if (!config) throw new Error(`Unexpected URL: ${url}`);

            return JSON.stringify({ tag_name: config.tagName });
        }
        const assetMatch = url.match(/^https:\/\/github\.com\/(.+)\/releases\/download\/([^/]+)\/(.+)$/);
        if (assetMatch) {
            const config = releaseConfigs[assetMatch[1]];
            if (!config) throw new Error(`Unexpected URL: ${url}`);

            if (assetMatch[3] === 'main.js') {
                return config.mainJs ?? 'Not Found';
            }
            if (assetMatch[3] === 'manifest.json') {
                return config.manifest ?? 'Not Found';
            }
            if (assetMatch[3] === 'styles.css') {
                return config.styles ?? 'Not Found';
            }
        }

        throw new Error(`Unexpected URL: ${url}`);
    });
};

describe('PluginsUpdater', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('uses the original release tag when downloading files', async () => {
        mockReleaseRequests({ tagName: 'v1.1.0' });
        const { updater, adapter } = createUpdater();

        await updater.update();

        const requestMock = request as MockRequest;
        expect(requestMock).toHaveBeenCalledWith({
            url: 'https://github.com/owner/sample-plugin/releases/download/v1.1.0/main.js',
        });
        expect(adapter.write).toHaveBeenCalledWith('.obsidian/plugins/sample-plugin/main.js', 'main js');
    });

    it('does not reload or mark success when required release files are missing', async () => {
        mockReleaseRequests({ tagName: '1.1.0', manifest: null });
        const { updater, adapter, enablePluginAndSave } = createUpdater();

        await updater.update();

        expect(adapter.write).not.toHaveBeenCalled();
        expect(enablePluginAndSave).not.toHaveBeenCalled();
        expect(mockProgressBarInstance.stepin).not.toHaveBeenCalled();
    });

    it('does not enable plugins that were disabled before the update', async () => {
        mockReleaseRequests({ tagName: '1.1.0' });
        const { updater, adapter, enablePluginAndSave } = createUpdater({ enabledPlugins: [] });

        await updater.update();

        expect(adapter.write).toHaveBeenCalledWith('.obsidian/plugins/sample-plugin/main.js', 'main js');
        expect(enablePluginAndSave).not.toHaveBeenCalled();
        expect(mockProgressBarInstance.stepin).toHaveBeenCalledWith(
            'sample-plugin',
            'update sample-plugin to 1.1.0',
            1
        );
    });

    it('checks enabled state at reload time instead of using a constructor snapshot', async () => {
        mockReleaseRequests({ tagName: '1.1.0' });
        const { updater, app, enablePluginAndSave } = createUpdater();
        app.plugins.enabledPlugins.delete('sample-plugin');

        await updater.update();

        expect(enablePluginAndSave).not.toHaveBeenCalled();
    });

    it('updates when the local version is invalid but the remote tag is valid', async () => {
        mockReleaseRequests({ tagName: '1.1.0' });
        const { updater, adapter } = createUpdater({
            manifests: {
                'sample-plugin': { id: 'sample-plugin', version: '' },
            },
        });

        await updater.update();

        expect(adapter.write).toHaveBeenCalledWith('.obsidian/plugins/sample-plugin/main.js', 'main js');
    });

    it('reloads updated enabled plugins serially after concurrent writes finish', async () => {
        mockReleaseRequests({
            releases: {
                'owner/sample-plugin': {
                    tagName: '1.1.0',
                    mainJs: 'main js',
                    manifest: '{"id":"sample-plugin","version":"1.1.0"}',
                    styles: 'styles',
                },
                'owner/second-plugin': {
                    tagName: '2.1.0',
                    mainJs: 'second main js',
                    manifest: '{"id":"second-plugin","version":"2.1.0"}',
                    styles: 'second styles',
                },
            },
        });
        const events: string[] = [];
        let activeReloads = 0;
        let maxActiveReloads = 0;
        const { updater, adapter, enablePluginAndSave } = createUpdater({
            enabledPlugins: ['sample-plugin', 'second-plugin'],
            manifests: {
                'sample-plugin': { id: 'sample-plugin', version: '1.0.0' },
                'second-plugin': { id: 'second-plugin', version: '2.0.0' },
            },
            repos: {
                'sample-plugin': 'owner/sample-plugin',
                'second-plugin': 'owner/second-plugin',
            },
        });
        adapter.write.mockImplementation(async (path: string) => {
            events.push(`write:${path}`);
        });
        enablePluginAndSave.mockImplementation(async (pluginID: string) => {
            activeReloads++;
            maxActiveReloads = Math.max(maxActiveReloads, activeReloads);
            events.push(`enable:${pluginID}`);
            await Promise.resolve();
            activeReloads--;
        });

        await updater.update();

        const firstEnableIndex = events.findIndex((event) => event.startsWith('enable:'));
        const lastWriteIndex = events.reduce(
            (lastIndex, event, index) => event.startsWith('write:') ? index : lastIndex,
            -1
        );
        expect(firstEnableIndex).toBeGreaterThan(lastWriteIndex);
        expect(maxActiveReloads).toBe(1);
        expect(enablePluginAndSave).toHaveBeenCalledTimes(2);
    });
});
