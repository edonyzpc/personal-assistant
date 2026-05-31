import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createRoot } from 'react-dom/client';

import { RecordPreview } from '../src/preview';
import { Stat } from '../src/stats-view';

jest.mock('obsidian');

jest.mock('react-dom/client', () => ({
    createRoot: jest.fn(),
}));

const mockCreateRoot = createRoot as jest.MockedFunction<typeof createRoot>;

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

describe('view async lifecycle guards', () => {
    beforeEach(() => {
        mockCreateRoot.mockReset();
        mockCreateRoot.mockReturnValue({
            render: jest.fn(),
            unmount: jest.fn(),
        });
    });

    it('does not register preview vault events after the view closes during initial refresh', async () => {
        const listResult = createDeferred<{ files: string[]; folders: string[] }>();
        const app = {
            vault: {
                adapter: {
                    list: jest.fn(() => listResult.promise),
                },
                getAbstractFileByPath: jest.fn(),
                on: jest.fn(),
                offref: jest.fn(),
            },
        };
        const plugin = {
            settings: {
                targetPath: '',
                fileFormat: '[record]',
                previewLimits: 5,
            },
            join: (...parts: string[]) => parts.join('/'),
            log: jest.fn(),
        };
        const view = new RecordPreview(app as never, plugin as never, { app, containerEl: {} } as never);

        const opened = view.onOpen();
        await Promise.resolve();
        await view.onClose();
        listResult.resolve({ files: [], folders: [] });
        await opened;

        expect(app.vault.on).not.toHaveBeenCalled();
        expect(mockCreateRoot).not.toHaveBeenCalled();
    });

    it('does not create a statistics React root after the view closes during data load', async () => {
        const flushResult = createDeferred<void>();
        const viewContent = {};
        const app = {};
        const plugin = {
            statsManager: {
                flush: jest.fn(() => flushResult.promise),
                getDashboardData: jest.fn(),
            },
        };
        const containerEl = {
            getElementsByClassName: jest.fn(() => [viewContent]),
        };
        const view = new Stat(app as never, plugin as never, { app, containerEl } as never);

        const opened = view.onOpen();
        await Promise.resolve();
        await view.onClose();
        flushResult.resolve();
        await opened;

        expect(mockCreateRoot).not.toHaveBeenCalled();
    });
});
