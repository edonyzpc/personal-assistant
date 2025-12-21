import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { VSS } from '../src/vss';
import { DirtyTimestamps } from '../src/vss-helpers';
import { TFile } from 'obsidian';

jest.mock('obsidian', () => {
    class MockTFile {
        path: string;
        stat: any; // eslint-disable-line @typescript-eslint/no-explicit-any
        extension: string;
        name: string;
        constructor(path: string, stat: any = {}, extension: string = 'md', name: string = path) { // eslint-disable-line @typescript-eslint/no-explicit-any
            this.path = path;
            this.stat = stat;
            this.extension = extension;
            this.name = name;
        }
    }
    return {
        TFile: MockTFile,
        TAbstractFile: MockTFile,
        Notice: class { },
        normalizePath: (p: string) => p,
    };
});

jest.mock('../src/ai-services/service', () => {
    return {
        AIService: class {
            constructor(..._args: any[]) { } // eslint-disable-line @typescript-eslint/no-explicit-any
            vectorizeDocument = jest.fn(async () => true);
            searchSimilarDocuments = jest.fn();
            ['aiUtils'] = { createEmbeddings: jest.fn() };
        }
    };
});

jest.mock('../src/ai-services/ai-utils', () => {
    return {
        AIUtils: class {
            constructor(..._args: any[]) { } // eslint-disable-line @typescript-eslint/no-explicit-any
            getDocumentContent(markdown: string) { return { content: markdown }; }
            cleanMarkdownContent(content: string) { return content; }
        }
    };
});

describe('VSS large file handling', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('keeps large files in the dirty queue while refreshing last timestamp', async () => {
        const baseTime = new Date('2025-01-01T00:00:00.000Z');
        jest.setSystemTime(baseTime);

        const mockAdapter = {
            write: jest.fn(),
            read: jest.fn(),
            exists: jest.fn(),
            remove: jest.fn(),
            mkdir: jest.fn(),
        };

        const mockVault = {
            adapter: mockAdapter,
            getAbstractFileByPath: jest.fn(),
        };

        const plugin: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
            settings: {
                apiToken: 'token',
                vssCacheExcludePath: [],
                aiProvider: 'openai',
                embeddingModelName: 'model',
                baseURL: '',
                chatModelName: '',
            },
            app: { vault: mockVault },
            join: (...parts: string[]) => parts.join('/'),
            log: jest.fn(),
        };

        const vss = new VSS(plugin, 'cache');

        const LargeFileCtor = TFile as unknown as { new(path: string, stat: any, extension?: string, name?: string): TFile }; // eslint-disable-line @typescript-eslint/no-explicit-any
        const largeFile = new LargeFileCtor('large.md', { size: 2_000_000, mtime: Date.now(), ctime: Date.now() }, 'md', 'large.md');

        mockVault.getAbstractFileByPath.mockReturnValue(largeFile);

        const firstTs = Date.now() - 60_000;
        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        dirtyMap.set(largeFile.path, { first: firstTs, last: firstTs });

        await vss.flush({ limit: 5, reason: 'test-large-file' });

        const updated = dirtyMap.get(largeFile.path);
        expect(updated).toBeDefined();
        expect(updated?.first).toBe(firstTs);
        expect(updated?.last).toBeGreaterThan(firstTs);
    });
});
