import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MarkdownView } from 'obsidian';
import type { App } from 'obsidian';
import type { Callout } from 'obsidian-callout-manager';

const mockNoticeMessages: string[] = [];

jest.mock('obsidian', () => {
    class MockSuggestModal {
        app: unknown;

        constructor(app: unknown) {
            this.app = app;
        }
    }

    class MockMarkdownView {
        editor: unknown;
        private mode: 'source' | 'preview';

        constructor(editor: unknown, mode: 'source' | 'preview' = 'source') {
            this.editor = editor;
            this.mode = mode;
        }

        getMode() {
            return this.mode;
        }
    }

    return {
        App: class { },
        Component: class { },
        SuggestModal: MockSuggestModal,
        MarkdownView: MockMarkdownView,
        Notice: class {
            constructor(message?: unknown) {
                mockNoticeMessages.push(String(message));
            }
        },
        getIcon: jest.fn(() => null),
    };
});

import { CalloutModal, DEFAULT_CALLOUTS } from '../src/callout';
import type { PluginManager } from '../src/plugin';

type EditorPosition = { line: number; ch: number };
type MockEditor = {
    getCursor: () => EditorPosition;
    replaceRange: (content: string, cursor: EditorPosition) => void;
    setCursor: (cursor: EditorPosition) => void;
};

const ViewCtor = MarkdownView as unknown as {
    new(editor: MockEditor, mode?: 'source' | 'preview'): MarkdownView;
};

function createApp(activeView: MarkdownView | null = null): App {
    return {
        workspace: {
            getActiveViewOfType: jest.fn(() => activeView),
        },
    } as unknown as App;
}

function createPlugin(calloutManager?: PluginManager['calloutManager']): PluginManager {
    return {
        calloutManager,
        log: jest.fn(),
    } as unknown as PluginManager;
}

function setClipboard(writeText: (content: string) => Promise<void>) {
    Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText } },
        configurable: true,
    });
}

const infoCallout: Callout = {
    id: 'info',
    icon: 'info',
    color: '8, 109, 221',
    sources: [{ type: 'builtin' }],
};

describe('CalloutModal', () => {
    beforeEach(() => {
        mockNoticeMessages.length = 0;
    });

    it('falls back to the built-in default callouts when Callout Manager is unavailable', () => {
        const modal = new CalloutModal(createApp(), createPlugin());

        const suggestions = modal.getSuggestions('warn');
        modal.getSuggestions('danger');

        expect(DEFAULT_CALLOUTS.length).toBeGreaterThan(1);
        expect(suggestions.map((callout) => callout.id)).toEqual(['warning']);
        expect(mockNoticeMessages).toEqual([
            'Callout Manager unavailable; showing default callouts only.',
        ]);
    });

    it('inserts into the active editor even when clipboard copy fails', async () => {
        const writeText = jest.fn<(content: string) => Promise<void>>(async () => {
            throw new Error('denied');
        });
        setClipboard(writeText);
        const cursor = { line: 2, ch: 3 };
        const editor = {
            getCursor: jest.fn(() => cursor),
            replaceRange: jest.fn(),
            setCursor: jest.fn(),
        };
        const view = new ViewCtor(editor, 'source');
        const plugin = createPlugin();
        const modal = new CalloutModal(createApp(view), plugin);

        await modal.onChooseSuggestion(infoCallout, {} as KeyboardEvent);

        expect(editor.replaceRange).toHaveBeenCalledWith(expect.stringContaining('> [!info] Info'), cursor);
        expect(editor.setCursor).toHaveBeenCalledWith({ line: 6, ch: 3 });
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('> [!info] Info'));
        expect(plugin.log).toHaveBeenCalledWith(
            'Failed to copy callout markdown to clipboard',
            expect.any(Error),
        );
        expect(mockNoticeMessages).toEqual([]);
    });

    it('keeps copy-to-clipboard as the fallback when no editable markdown view is active', async () => {
        const writeText = jest.fn<(content: string) => Promise<void>>(async () => undefined);
        setClipboard(writeText);
        const modal = new CalloutModal(createApp(null), createPlugin());

        await modal.onChooseSuggestion(infoCallout, {} as KeyboardEvent);

        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('> [!info] Info'));
        expect(mockNoticeMessages).toEqual([
            'No editable markdown file; callout copied to clipboard',
        ]);
    });
});
