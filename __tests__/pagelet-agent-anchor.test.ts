import { describe, expect, it, jest } from '@jest/globals';

import type { ChatToolContext } from '../src/ai-services/chat-tools';
import {
    capturePageletAnchorSnapshot,
} from '../src/pagelet/agent/anchor-snapshot';
import {
    createAnchorBoundCurrentNoteTool,
    createAnchorBoundInspectNoteTool,
} from '../src/pagelet/agent/anchor-note-tool';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';

jest.mock('obsidian');

function createHost(options: { mutateDuringRead?: boolean; renameDuringRead?: boolean } = {}) {
    const file = {
        path: 'notes/anchor.md',
        basename: 'anchor',
        stat: { mtime: 10, size: 24 },
    };
    const active = {
        file: { path: 'notes/other.md', basename: 'other', stat: { mtime: 20, size: 10 } },
        editor: { getValue: () => 'other active content' },
    };
    const cachedRead = jest.fn(async () => {
        if (options.mutateDuringRead) {
            file.stat = { mtime: 11, size: 25 };
        }
        if (options.renameDuringRead) {
            file.path = 'notes/renamed.md';
        }
        return '# Anchor\nfrozen evidence';
    });
    const host = {
        app: {
            vault: {
                getAbstractFileByPath: (path: string) => path === file.path ? file : null,
                getMarkdownFiles: () => [file],
                cachedRead,
            },
            workspace: {
                getActiveViewOfType: () => active,
            },
        },
        log: jest.fn(),
    } as unknown as AiServiceHost;
    return { host, file, cachedRead };
}

describe('Pagelet frozen anchor', () => {
    it('keeps get_current_note_context bound to captured content after workspace focus changes', async () => {
        const { host } = createHost();
        const snapshot = await capturePageletAnchorSnapshot({
            host,
            path: 'notes/anchor.md',
            isPathAllowed: () => true,
            now: () => 100,
        });
        expect(snapshot).not.toBeNull();
        const tool = createAnchorBoundCurrentNoteTool(snapshot!);
        const result = await tool.execute(
            { mode: 'full' },
            { host } as ChatToolContext,
        );

        expect(result.ok).toBe(true);
        expect(result.content).toMatchObject({
            path: 'notes/anchor.md',
            fullText: '# Anchor\nfrozen evidence',
            mtime: 10,
            contentHash: snapshot?.contentHash,
        });
        expect(result.content?.path).not.toBe('notes/other.md');
    });

    it('maps omitted and explicit anchor inspection to frozen content without a live re-read', async () => {
        const { host, cachedRead } = createHost();
        const snapshot = await capturePageletAnchorSnapshot({
            host,
            path: 'notes/anchor.md',
            isPathAllowed: () => true,
        });
        cachedRead.mockClear();
        const tool = createAnchorBoundInspectNoteTool(snapshot!, () => true);

        const omitted = await tool.execute({}, { host } as ChatToolContext);
        const explicit = await tool.execute(
            { path: 'notes/anchor.md' },
            { host } as ChatToolContext,
        );

        expect(omitted.content).toMatchObject({
            path: 'notes/anchor.md',
            fullText: '# Anchor\nfrozen evidence',
            contentHash: snapshot?.contentHash,
        });
        expect(explicit.content).toMatchObject({
            path: 'notes/anchor.md',
            fullText: '# Anchor\nfrozen evidence',
        });
        expect(cachedRead).not.toHaveBeenCalled();
    });

    it('fails closed when the file changes during snapshot capture', async () => {
        const { host } = createHost({ mutateDuringRead: true });
        const snapshot = await capturePageletAnchorSnapshot({
            host,
            path: 'notes/anchor.md',
            isPathAllowed: () => true,
        });

        expect(snapshot).toBeNull();
    });

    it('fails closed when the file is renamed during snapshot capture', async () => {
        const { host } = createHost({ renameDuringRead: true });
        const snapshot = await capturePageletAnchorSnapshot({
            host,
            path: 'notes/anchor.md',
            isPathAllowed: () => true,
        });

        expect(snapshot).toBeNull();
    });

    it('checks the data boundary before reading the anchor', async () => {
        const { host, cachedRead } = createHost();
        const snapshot = await capturePageletAnchorSnapshot({
            host,
            path: 'notes/anchor.md',
            isPathAllowed: () => false,
        });

        expect(snapshot).toBeNull();
        expect(cachedRead).not.toHaveBeenCalled();
    });
});
