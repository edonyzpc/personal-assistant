import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { strToU8, zipSync } from 'fflate';
import { Notice, request, requestUrl } from 'obsidian';
import { ThemeUpdater } from '../src/theme-manifest';

const mockProgressBarInstance = {
    show: jest.fn(),
    addDiv: jest.fn(),
    stepin: jest.fn(),
    updateProgress: jest.fn(),
    hide: jest.fn(),
};

jest.mock('obsidian', () => ({
    Notice: jest.fn(),
    request: jest.fn(),
    requestUrl: jest.fn(),
    normalizePath: (path: string) => path,
}));

jest.mock('../src/progress-bar', () => ({
    ProgressBar: jest.fn(() => mockProgressBarInstance),
}));

type MockRequest = jest.MockedFunction<typeof request>;
type MockRequestUrl = jest.MockedFunction<typeof requestUrl>;
type ThemeAsset = {
    name: string;
    browser_download_url: string;
};
type ReleaseConfig = {
    tagName: string;
    assets?: ThemeAsset[];
    textDownloads?: Record<string, string | null>;
    zipDownloads?: Record<string, ArrayBuffer>;
};
type ManifestRead = string | Error | (() => Promise<string> | string);

const COMMUNITY_THEMES_URL = 'https://cdn.jsdelivr.net/gh/obsidianmd/obsidian-releases@master/community-css-themes.json';
const SOURCE_ZIP_URL = 'https://github.com/owner/sample-theme/archive/refs/tags/1.1.0.zip';

let setTimeoutSpy: jest.SpiedFunction<typeof setTimeout>;

const themeManifest = (name: string, version: string) => JSON.stringify({ name, version });

const createZip = async (files: Record<string, string>) => {
    const zip = zipSync(Object.fromEntries(
        Object.entries(files).map(([path, content]) => [path, strToU8(content)])
    ));

    return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
};

const getUrl = (requestParam: Parameters<typeof request>[0] | Parameters<typeof requestUrl>[0]) => {
    return typeof requestParam === 'string' ? requestParam : requestParam.url;
};

const createRequestUrlResponse = (arrayBuffer: ArrayBuffer): ReturnType<typeof requestUrl> => {
    const response = Promise.resolve({
        status: 200,
        headers: {},
        arrayBuffer,
        json: null,
        text: '',
    }) as ReturnType<typeof requestUrl>;
    response.arrayBuffer = Promise.resolve(arrayBuffer);
    response.json = Promise.resolve(null);
    response.text = Promise.resolve('');

    return response;
};

const mockReleaseRequests = (releases: Record<string, ReleaseConfig> = {}) => {
    const requestMock = request as MockRequest;
    const requestUrlMock = requestUrl as MockRequestUrl;
    requestMock.mockImplementation(async (requestParam) => {
        const url = getUrl(requestParam);
        if (url === COMMUNITY_THEMES_URL) {
            return '[]';
        }

        const latestReleaseMatch = url.match(/^https:\/\/api\.github\.com\/repos\/(.+)\/releases\/latest$/);
        if (latestReleaseMatch) {
            const config = releases[latestReleaseMatch[1]];
            if (!config) throw new Error(`Unexpected URL: ${url}`);

            return JSON.stringify({
                tag_name: config.tagName,
                assets: config.assets ?? [],
            });
        }

        for (const config of Object.values(releases)) {
            if (config.textDownloads && Object.prototype.hasOwnProperty.call(config.textDownloads, url)) {
                return config.textDownloads[url] ?? 'Not Found';
            }
        }

        throw new Error(`Unexpected URL: ${url}`);
    });
    requestUrlMock.mockImplementation((requestParam) => {
        const url = getUrl(requestParam);
        for (const config of Object.values(releases)) {
            if (config.zipDownloads && Object.prototype.hasOwnProperty.call(config.zipDownloads, url)) {
                return createRequestUrlResponse(config.zipDownloads[url]);
            }
        }

        throw new Error(`Unexpected URL: ${url}`);
    });
};

const createUpdater = async ({
    currentTheme = '',
    customCss = undefined,
    existsResults = {},
    manifestReads = {
        '.obsidian/themes/sample-theme/manifest.json': themeManifest('sample-theme', '1.0.0'),
    },
    repos = {
        'sample-theme': 'owner/sample-theme',
    },
}: {
    currentTheme?: string;
    customCss?: object;
    existsResults?: Record<string, boolean>;
    manifestReads?: Record<string, ManifestRead>;
    repos?: Record<string, string>;
} = {}) => {
    const themeFolders = Object.keys(manifestReads).map((path) => path.replace(/\/manifest\.json$/, ''));
    const adapter = {
        list: jest.fn<(path: string) => Promise<{ folders: string[]; files: string[] }>>(async () => ({
            folders: themeFolders,
            files: [],
        })),
        read: jest.fn<(path: string) => Promise<string>>(async (path) => {
            const read = manifestReads[path];
            if (read instanceof Error) throw read;
            if (typeof read === 'function') return await read();
            if (typeof read === 'string') return read;

            throw new Error(`Missing manifest: ${path}`);
        }),
        exists: jest.fn<(path: string) => Promise<boolean>>(async (path) => existsResults[path] ?? true),
        mkdir: jest.fn<(path: string) => Promise<void>>(async () => undefined),
        write: jest.fn<(path: string, data: string) => Promise<void>>(async () => undefined),
    };
    const app = {
        vault: {
            configDir: '.obsidian',
            adapter,
            getConfig: jest.fn((key: string) => key === 'cssTheme' ? currentTheme : undefined),
        },
        customCss,
    };
    const plugin = {
        settings: {
            cacheThemeRepo: repos,
        },
        saveSettings: jest.fn(async () => undefined),
        log: jest.fn(),
    };

    return {
        updater: await ThemeUpdater.init(app as any, plugin as any), // eslint-disable-line @typescript-eslint/no-explicit-any
        app,
        adapter,
        plugin,
    };
};

describe('ThemeUpdater', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback: TimerHandler) => {
            if (typeof callback === 'function') {
                callback();
            }

            return 0 as unknown as ReturnType<typeof setTimeout>;
        });
        mockReleaseRequests();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('waits for all installed theme manifests before returning from init', async () => {
        let resolveDelayedManifest!: (value: string) => void;
        const delayedManifest = new Promise<string>((resolve) => {
            resolveDelayedManifest = resolve;
        });
        const initPromise = createUpdater({
            manifestReads: {
                '.obsidian/themes/sample-theme/manifest.json': themeManifest('sample-theme', '1.0.0'),
                '.obsidian/themes/slow-theme/manifest.json': () => delayedManifest,
            },
            repos: {
                'sample-theme': 'owner/sample-theme',
                'slow-theme': 'owner/slow-theme',
            },
        });
        let settled = false;
        initPromise.then(() => {
            settled = true;
        });

        await Promise.resolve();

        expect(settled).toBe(false);
        resolveDelayedManifest(themeManifest('slow-theme', '2.0.0'));
        const { updater } = await initPromise;
        expect(updater.items).toEqual([
            { id: 'sample-theme', version: '1.0.0' },
            { id: 'slow-theme', version: '2.0.0' },
        ]);
    });

    it('skips missing or invalid theme manifests without interrupting init', async () => {
        const { updater, plugin } = await createUpdater({
            manifestReads: {
                '.obsidian/themes/sample-theme/manifest.json': themeManifest('sample-theme', '1.0.0'),
                '.obsidian/themes/bad-theme/manifest.json': '{bad',
                '.obsidian/themes/missing-theme/manifest.json': new Error('missing manifest'),
                '.obsidian/themes/empty-theme/manifest.json': JSON.stringify({ name: 'empty-theme' }),
            },
        });

        expect(updater.items).toEqual([
            { id: 'sample-theme', version: '1.0.0' },
        ]);
        expect(plugin.log).toHaveBeenCalledWith(
            'skip unreadable theme manifest: .obsidian/themes/bad-theme/manifest.json',
            expect.any(SyntaxError)
        );
        expect(plugin.log).toHaveBeenCalledWith(
            'skip unreadable theme manifest: .obsidian/themes/missing-theme/manifest.json',
            expect.any(Error)
        );
        expect(plugin.log).toHaveBeenCalledWith(
            'skip invalid theme manifest: .obsidian/themes/empty-theme/manifest.json'
        );
    });

    it('downloads direct theme and manifest release assets', async () => {
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [
                    { name: 'theme.css', browser_download_url: 'https://downloads/sample/theme.css' },
                    { name: 'manifest.json', browser_download_url: 'https://downloads/sample/manifest.json' },
                ],
                textDownloads: {
                    'https://downloads/sample/theme.css': 'theme css',
                    'https://downloads/sample/manifest.json': themeManifest('sample-theme', '1.1.0'),
                },
            },
        });
        const { updater, adapter } = await createUpdater();

        await updater.update();

        expect(adapter.write).toHaveBeenCalledWith('.obsidian/themes/sample-theme/theme.css', 'theme css');
        expect(adapter.write).toHaveBeenCalledWith(
            '.obsidian/themes/sample-theme/manifest.json',
            themeManifest('sample-theme', '1.1.0')
        );
        expect(mockProgressBarInstance.stepin).toHaveBeenCalledWith(
            'sample-theme',
            'update sample-theme to 1.1.0',
            1
        );
    });

    it('updates an existing theme folder even when manifest.json was missing', async () => {
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [
                    { name: 'theme.css', browser_download_url: 'https://downloads/sample/theme.css' },
                    { name: 'manifest.json', browser_download_url: 'https://downloads/sample/manifest.json' },
                ],
                textDownloads: {
                    'https://downloads/sample/theme.css': 'theme css',
                    'https://downloads/sample/manifest.json': themeManifest('sample-theme', '1.1.0'),
                },
            },
        });
        const { updater, adapter } = await createUpdater({
            existsResults: {
                '.obsidian/themes/sample-theme/': true,
                '.obsidian/themes/sample-theme/manifest.json': false,
            },
        });
        adapter.mkdir.mockRejectedValue(new Error('folder already exists'));

        await updater.update();

        expect(adapter.mkdir).not.toHaveBeenCalled();
        expect(adapter.write).toHaveBeenCalledWith('.obsidian/themes/sample-theme/theme.css', 'theme css');
        expect(adapter.write).toHaveBeenCalledWith(
            '.obsidian/themes/sample-theme/manifest.json',
            themeManifest('sample-theme', '1.1.0')
        );
        expect(mockProgressBarInstance.stepin).toHaveBeenCalledWith(
            'sample-theme',
            'update sample-theme to 1.1.0',
            1
        );
    });

    it('downloads and extracts zip release assets', async () => {
        const zipBytes = await createZip({
            'release/theme.css': 'zip theme css',
            'release/manifest.json': themeManifest('sample-theme', '1.1.0'),
        });
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [
                    { name: 'release.zip', browser_download_url: 'https://downloads/sample/release.zip' },
                ],
                zipDownloads: {
                    'https://downloads/sample/release.zip': zipBytes,
                },
            },
        });
        const { updater, adapter } = await createUpdater();

        await updater.update();

        expect(adapter.write).toHaveBeenCalledWith('.obsidian/themes/sample-theme/theme.css', 'zip theme css');
        expect(adapter.write).toHaveBeenCalledWith(
            '.obsidian/themes/sample-theme/manifest.json',
            themeManifest('sample-theme', '1.1.0')
        );
    });

    it('falls back to the source archive when no release assets are usable', async () => {
        const sourceZipBytes = await createZip({
            'sample-theme-1.1.0/theme.css': 'source theme css',
            'sample-theme-1.1.0/manifest.json': themeManifest('sample-theme', '1.1.0'),
        });
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [],
                zipDownloads: {
                    [SOURCE_ZIP_URL]: sourceZipBytes,
                },
            },
        });
        const { updater, adapter } = await createUpdater();

        await updater.update();

        expect(requestUrl).toHaveBeenCalledWith({ url: SOURCE_ZIP_URL });
        expect(adapter.write).toHaveBeenCalledWith('.obsidian/themes/sample-theme/theme.css', 'source theme css');
        expect(adapter.write).toHaveBeenCalledWith(
            '.obsidian/themes/sample-theme/manifest.json',
            themeManifest('sample-theme', '1.1.0')
        );
    });

    it('does not write or mark success when required release files are missing', async () => {
        const sourceZipBytes = await createZip({
            'sample-theme-1.1.0/theme.css': 'source theme css',
        });
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [
                    { name: 'theme.css', browser_download_url: 'https://downloads/sample/theme.css' },
                ],
                textDownloads: {
                    'https://downloads/sample/theme.css': 'theme css',
                },
                zipDownloads: {
                    [SOURCE_ZIP_URL]: sourceZipBytes,
                },
            },
        });
        const customCss = {
            readThemes: jest.fn<(reloadTheme?: boolean) => void>(),
        };
        const { updater, adapter } = await createUpdater({ currentTheme: 'sample-theme', customCss });

        await updater.update();

        expect(adapter.write).not.toHaveBeenCalled();
        expect(mockProgressBarInstance.stepin).not.toHaveBeenCalled();
        expect(customCss.readThemes).not.toHaveBeenCalled();
    });

    it('reloads Obsidian CSS when the current theme was updated', async () => {
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [
                    { name: 'theme.css', browser_download_url: 'https://downloads/sample/theme.css' },
                    { name: 'manifest.json', browser_download_url: 'https://downloads/sample/manifest.json' },
                ],
                textDownloads: {
                    'https://downloads/sample/theme.css': 'theme css',
                    'https://downloads/sample/manifest.json': themeManifest('sample-theme', '1.1.0'),
                },
            },
        });
        const customCss = {
            readThemes: jest.fn<(reloadTheme?: boolean) => void>(),
        };
        const { updater } = await createUpdater({ currentTheme: 'sample-theme', customCss });

        await updater.update();

        expect(customCss.readThemes).toHaveBeenCalledWith(true);
    });

    it('falls back to reloadTheme when readThemes is unavailable', async () => {
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [
                    { name: 'theme.css', browser_download_url: 'https://downloads/sample/theme.css' },
                    { name: 'manifest.json', browser_download_url: 'https://downloads/sample/manifest.json' },
                ],
                textDownloads: {
                    'https://downloads/sample/theme.css': 'theme css',
                    'https://downloads/sample/manifest.json': themeManifest('sample-theme', '1.1.0'),
                },
            },
        });
        const customCss = {
            reloadTheme: jest.fn<() => void>(),
        };
        const { updater } = await createUpdater({ currentTheme: 'sample-theme', customCss });

        await updater.update();

        expect(customCss.reloadTheme).toHaveBeenCalledTimes(1);
    });

    it('does not reload Obsidian CSS when a non-current theme was updated', async () => {
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [
                    { name: 'theme.css', browser_download_url: 'https://downloads/sample/theme.css' },
                    { name: 'manifest.json', browser_download_url: 'https://downloads/sample/manifest.json' },
                ],
                textDownloads: {
                    'https://downloads/sample/theme.css': 'theme css',
                    'https://downloads/sample/manifest.json': themeManifest('sample-theme', '1.1.0'),
                },
            },
        });
        const customCss = {
            readThemes: jest.fn<(reloadTheme?: boolean) => void>(),
        };
        const { updater } = await createUpdater({ currentTheme: 'other-theme', customCss });

        await updater.update();

        expect(customCss.readThemes).not.toHaveBeenCalled();
    });

    it('falls back safely when Obsidian CSS reload APIs are unavailable', async () => {
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [
                    { name: 'theme.css', browser_download_url: 'https://downloads/sample/theme.css' },
                    { name: 'manifest.json', browser_download_url: 'https://downloads/sample/manifest.json' },
                ],
                textDownloads: {
                    'https://downloads/sample/theme.css': 'theme css',
                    'https://downloads/sample/manifest.json': themeManifest('sample-theme', '1.1.0'),
                },
            },
        });
        const { updater } = await createUpdater({ currentTheme: 'sample-theme', customCss: {} });

        await expect(updater.update()).resolves.toBeUndefined();
        expect(Notice).toHaveBeenCalledWith(
            'Theme files updated. Switch themes or restart Obsidian to apply.',
            5000
        );
    });

    it('uses a one-shot timer when hiding the update notice', async () => {
        const setIntervalSpy = jest.spyOn(global, 'setInterval');
        mockReleaseRequests({
            'owner/sample-theme': {
                tagName: '1.1.0',
                assets: [
                    { name: 'theme.css', browser_download_url: 'https://downloads/sample/theme.css' },
                    { name: 'manifest.json', browser_download_url: 'https://downloads/sample/manifest.json' },
                ],
                textDownloads: {
                    'https://downloads/sample/theme.css': 'theme css',
                    'https://downloads/sample/manifest.json': themeManifest('sample-theme', '1.1.0'),
                },
            },
        });
        const { updater } = await createUpdater();

        await updater.update();

        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setIntervalSpy).not.toHaveBeenCalled();
    });
});
