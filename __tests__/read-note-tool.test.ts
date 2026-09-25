import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import { chatToolResultToAgentCapabilityResult } from '../src/ai-services/capability-adapter';
import { createCurrentNoteContextTool, createReadNoteTool } from '../src/ai-services/chat-tool-factories';
import type { ChatToolContext, ChatToolResult } from '../src/ai-services/chat-tool-types';
import { isReadNoteResult } from '../src/ai-services/chat-tool-guards';
import { readVaultFile } from '../src/ai-services/chat-tool-execution-helpers';
import { computeContentHash } from '../src/vss-helpers';
import type { ReadNoteOutput } from '../src/ai-services/chat-tool-types';
import type { Workspace } from 'obsidian';
import type { PaAgentMessage } from '../src/ai-services/chat-types';
import { TaskSourceRun } from '../src/ai-services/task-source-run';

jest.mock('obsidian');

jest.mock('../src/vss-helpers', () => ({
    computeContentHash: jest.fn(async (input: string) => {
        const { createHash } = jest.requireActual('node:crypto') as typeof import('node:crypto');
        return createHash('sha1').update(input, 'utf8').digest('hex');
    }),
}));

function hostWithVault(vault: Record<string, unknown>): AiServiceHost {
    return { app: { vault } } as unknown as AiServiceHost;
}

describe('read_note vault body read helper', () => {
    const file = { path: 'notes/a.md', extension: 'md', stat: { size: 4 } };

    it('rejects when cachedRead is unavailable instead of returning an empty body', async () => {
        await expect(readVaultFile(hostWithVault({}), file))
            .rejects.toThrow();
    });

    it('returns an empty string for a real empty file', async () => {
        const cachedRead = jest.fn(async () => '');
        await expect(readVaultFile(hostWithVault({ cachedRead }), file))
            .resolves.toBe('');
        expect(cachedRead).toHaveBeenCalledWith(file);
    });

    it('calls cachedRead with the original vault as the receiver', async () => {
        const vault = {
            contents: { 'notes/a.md': 'receiver body' } as Record<string, string>,
            cachedRead(readFile: { path: string }) {
                return Promise.resolve(this.contents[readFile.path] ?? '');
            },
        };
        await expect(readVaultFile(hostWithVault(vault), file))
            .resolves.toBe('receiver body');
    });

    it('propagates an actual vault read failure', async () => {
        const cachedRead = jest.fn(async () => {
            throw new Error('physical vault read failed');
        });
        await expect(readVaultFile(hostWithVault({ cachedRead }), file))
            .rejects.toThrow('physical vault read failed');
        expect(cachedRead).toHaveBeenCalledWith(file);
    });
});

function setup(content: string, options: { path?: string; stat?: Record<string, unknown> } = {}) {
    const path = options.path ?? 'notes/source.md';
    const file = {
        path,
        name: 'source.md',
        basename: 'source',
        extension: 'md',
        stat: { mtime: 101, ctime: 100, size: new TextEncoder().encode(content).length, ...options.stat },
    };
    let currentFile: typeof file | null = file;
    let currentContent = content;
    let current = true;
    const allowed = new Set(['notes/source.md', 'notes/allowed.md', path]);
    const cachedRead = jest.fn(async (readFile: typeof file) => {
        if (readFile !== currentFile) throw new Error('Read an unexpected file object.');
        return currentContent;
    });
    const lookup = jest.fn((requestedPath: string) => requestedPath === path ? currentFile : null);
    const editor = {
        getValue: jest.fn(() => 'active editor content'),
        getSelection: jest.fn(() => 'active editor selection'),
        lineCount: jest.fn(() => 1),
        getLine: jest.fn(() => 'active editor content'),
        getCursor: jest.fn(() => ({ line: 0, ch: 0 })),
    };
    const view = { file: { path: 'notes/active.md' }, editor };
    const host = {
        app: {
            vault: { getAbstractFileByPath: lookup, cachedRead },
            workspace: { getActiveViewOfType: () => view },
        },
    } as unknown as AiServiceHost;
    const context: ChatToolContext = {
        host,
        taskSourceReadGuard: {
            isCurrent: () => current,
            isPathAllowed: (candidate: string) => allowed.has(candidate),
        },
    };
    const tool = createReadNoteTool();
    const invoke = (rawInput: Record<string, unknown>, invokeContext: ChatToolContext = context) =>
        tool.execute(tool.validateInput(rawInput), invokeContext);
    return {
        tool,
        file,
        path,
        context,
        invoke,
        cachedRead,
        lookup,
        editor,
        view,
        allowed,
        replaceFile: (nextFile: typeof file | null) => { currentFile = nextFile; },
        replaceContent: (nextContent: string) => {
            currentContent = nextContent;
            file.stat.size = new TextEncoder().encode(nextContent).length;
        },
        revoke: () => { current = false; },
    };
}

function output(result: ChatToolResult<ReadNoteOutput>): ReadNoteOutput {
    expect(result.ok).toBe(true);
    expect(result.content).toBeTruthy();
    return result.content!;
}

describe('createReadNoteTool', () => {
    it('keeps the observed A body revision in a Writing source snapshot after the file becomes B', async () => {
        const f = setup('Version A');
        const read = await f.invoke({ path: f.path });
        expect(read.ok).toBe(true);
        const adapted = chatToolResultToAgentCapabilityResult(
            { name: 'read_note', sourceBoundary: 'read-only-tool' }, 'core', read,
        );
        f.replaceContent('Version B');
        f.file.stat.mtime += 1;
        const workspace = { getActiveViewOfType: () => null, getMostRecentLeaf: () => null,
            getLeavesOfType: () => [] } as unknown as Workspace;
        const run = new TaskSourceRun({ runId: 'run', userMessageId: 'user', userText: 'Write from this note',
            workspace, getFileByPath: path => path === f.path ? f.file : null, isCurrent: () => true });
        const transcript: PaAgentMessage[] = [{ role: 'toolResult', id: 'read-result', toolCallId: 'read-call',
            toolName: 'read_note', timestamp: 1, isError: false,
            content: { promptText: JSON.stringify(read.content), includeInNextPrompt: true,
                sourceRecords: adapted.sourceRecords } }];

        expect(run.captureGenerationInputTaskSources(transcript, [])).toMatchObject({
            state: 'identified',
            sources: [{ revision: { state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: await computeContentHash('Version A') },
                stat: { mtime: 101, size: 9 } } }],
        });
    });

    it('distinguishes equal-stat bodies and marks unsaved editor text as an editor projection', async () => {
        const f = setup('A');
        const before = await f.invoke({ path: f.path });
        f.replaceContent('B');
        const after = await f.invoke({ path: f.path });
        expect(f.file.stat.size).toBe(1);
        expect(before.sources[0].observedRevision).toMatchObject({
            basis: 'vault_read', digest: { scope: 'whole_file', value: await computeContentHash('A') },
            stat: { mtime: 101, size: 1 },
        });
        expect(after.sources[0].observedRevision).toMatchObject({
            basis: 'vault_read', digest: { scope: 'whole_file', value: await computeContentHash('B') },
            stat: { mtime: 101, size: 1 },
        });
        f.allowed.add('notes/active.md');
        const editorTool = createCurrentNoteContextTool();
        const editorResult = await editorTool.execute(editorTool.validateInput({ mode: 'full' }), f.context);
        const editorRecord = chatToolResultToAgentCapabilityResult(editorTool, 'core', editorResult).sourceRecords[0];
        expect(editorRecord.observedRevision).toMatchObject({ state: 'identified', basis: 'editor_snapshot',
            digest: { algorithm: 'sha1', scope: 'editor_projection' } });
        expect(editorRecord.observedRevision).not.toHaveProperty('stat');
    });

    it('separates saved body content from raw YAML properties with original-file lines', async () => {
        const content = '---\ndate: 2026-01-01\ntags: [project]\n---\nBody mentions 2026-02-03.\nSecond body line.\n';
        const f = setup(content);

        const body = output(await f.invoke({ path: f.path }));
        expect(body.part).toBe('body');
        expect(body.contentKind).toBe('markdown-body');
        expect(body.text).toBe('Body mentions 2026-02-03.\nSecond body line.\n');
        expect(body.range).toMatchObject({ startLine: 5, endLine: 6, partialLine: false });
        expect(body.complete).toBe(true);
        expect(body.endOfPart).toBe(true);

        const properties = output(await f.invoke({ path: f.path, part: 'properties' }));
        expect(properties.part).toBe('properties');
        expect(properties.contentKind).toBe('raw-frontmatter');
        expect(properties.text).toBe('date: 2026-01-01\ntags: [project]');
        expect(properties.range).toMatchObject({ startLine: 2, endLine: 3, partialLine: false });
        expect(properties.complete).toBe(true);
        expect(properties.endOfPart).toBe(true);
        expect(isReadNoteResult(properties)).toBe(true);
    });

    it('returns an empty body for a real empty Markdown file', async () => {
        const f = setup('');
        const result = output(await f.invoke({ path: f.path }));
        expect(result.text).toBe('');
        expect(result.complete).toBe(true);
        expect(result.endOfPart).toBe(true);
        expect(result.nextCursor).toBeUndefined();
        expect(f.cachedRead).toHaveBeenCalledTimes(1);
    });

    it('preserves the vault receiver through the normal read-note factory path', async () => {
        const content = 'Body from vault receiver';
        const file = {
            path: 'notes/source.md',
            name: 'source.md',
            basename: 'source',
            extension: 'md',
            stat: { mtime: 1, ctime: 1, size: new TextEncoder().encode(content).length },
        };
        const vault = {
            contents: { 'notes/source.md': content } as Record<string, string>,
            getAbstractFileByPath: (path: string) => path === file.path ? file : null,
            cachedRead(readFile: { path: string }) {
                return Promise.resolve(this.contents[readFile.path] ?? '');
            },
        };
        const tool = createReadNoteTool();
        const result = await tool.execute(
            tool.validateInput({ path: file.path }),
            { host: { app: { vault } } as never },
        );

        expect(result.ok).toBe(true);
        expect(result.content).toMatchObject({ text: content, complete: true });
    });

    it('continues a long single line without losing emoji or CRLF characters', async () => {
        const emojiLine = '😀'.repeat(12);
        const f = setup(emojiLine);
        const first = output(await f.invoke({ path: f.path, maxChars: 5 }));
        expect(first.text).toBe('😀'.repeat(5));
        expect(first.range).toMatchObject({ startLine: 1, endLine: 1, partialLine: true });
        expect(first.truncated).toBe(true);
        expect(first.complete).toBe(false);
        const second = output(await f.invoke({ path: f.path, cursor: first.nextCursor!, maxChars: 20 }));
        expect(second.text).toBe('😀'.repeat(7));
        expect(second.complete).toBe(true);
        expect(second.endOfPart).toBe(true);
        expect(first.text + second.text).toBe(emojiLine);

        const crlf = setup('first\r\nsecond\r\nthird');
        const crlfFirst = output(await crlf.invoke({
            path: crlf.path, startLine: 1, endLine: 2, maxChars: 6,
        }));
        expect(crlfFirst.text).toBe('first\r');
        expect(crlfFirst.range.partialLine).toBe(true);
        const crlfSecond = output(await crlf.invoke({
            path: crlf.path, cursor: crlfFirst.nextCursor!, maxChars: 20,
        }));
        expect(crlfFirst.text + crlfSecond.text).toBe('first\r\nsecond\r\n');
        expect(crlfSecond.complete).toBe(true);
        expect(crlfSecond.endOfPart).toBe(false);
    });

    it('continues raw properties through a cursor without inventing a line range', async () => {
        const rawProperties = `key: ${'value '.repeat(12)}`;
        const f = setup(`---\n${rawProperties}\n---\nbody`);
        const first = output(await f.invoke({
            path: f.path,
            part: 'properties',
            maxChars: 7,
        }));
        expect(first.part).toBe('properties');
        expect(first.truncated).toBe(true);
        expect(first.nextCursor).toBeTruthy();
        expect(JSON.parse(first.nextCursor!)).not.toHaveProperty('startLine');
        expect(JSON.parse(first.nextCursor!)).not.toHaveProperty('endLine');

        let text = first.text;
        let current = first;
        for (let page = 0; page < 20 && current.nextCursor; page += 1) {
            const inherited = output(await f.invoke({
                path: f.path,
                cursor: current.nextCursor,
                maxChars: 7,
            }));
            expect(inherited.part).toBe('properties');
            expect(inherited.contentKind).toBe('raw-frontmatter');
            text += inherited.text;
            current = inherited;
        }
        expect(current.complete).toBe(true);
        expect(current.endOfPart).toBe(true);
        expect(current.nextCursor).toBeUndefined();
        expect(text).toBe(rawProperties);

        const firstPage = output(await f.invoke({ path: f.path, part: 'properties', maxChars: 7 }));
        const explicitSamePart = output(await f.invoke({
            path: f.path,
            part: 'properties',
            cursor: firstPage.nextCursor!,
            maxChars: 7,
        }));
        expect(explicitSamePart.part).toBe('properties');
        const explicitDifferentPart = await f.invoke({
            path: f.path,
            part: 'body',
            cursor: firstPage.nextCursor!,
            maxChars: 7,
        });
        expect(explicitDifferentPart.ok).toBe(false);
    });

    it('keeps CRLF and EOF empty ranges monotonic across real continuations', async () => {
        const crlf = setup('a\r\nb');
        const crlfFirst = output(await crlf.invoke({ path: crlf.path, maxChars: 1 }));
        const splitCursor = JSON.parse(crlfFirst.nextCursor!) as Record<string, unknown>;
        splitCursor.offset = 2;
        const split = output(await crlf.invoke({
            path: crlf.path,
            cursor: JSON.stringify(splitCursor),
            maxChars: 1,
        }));
        expect(split.text).toBe('\n');
        expect(split.range).toMatchObject({
            startLine: 1,
            endLine: 1,
            startOffset: 2,
            endOffset: 3,
            partialLine: true,
        });
        const afterSplit = output(await crlf.invoke({
            path: crlf.path,
            cursor: split.nextCursor!,
            maxChars: 2,
        }));
        expect(afterSplit.text).toBe('b');
        expect(afterSplit.range).toMatchObject({ startLine: 2, endLine: 2 });
        expect(afterSplit.complete).toBe(true);

        const lf = setup('a\nb');
        const lfFirst = output(await lf.invoke({ path: lf.path, maxChars: 1 }));
        const lfCursor = JSON.parse(lfFirst.nextCursor!) as Record<string, unknown>;
        lfCursor.offset = 2;
        const afterLineBreak = output(await lf.invoke({
            path: lf.path,
            cursor: JSON.stringify(lfCursor),
            maxChars: 1,
        }));
        expect(afterLineBreak.text).toBe('b');
        expect(afterLineBreak.range).toMatchObject({ startLine: 2, endLine: 2 });

        const eof = setup('a\n');
        const eofFirst = output(await eof.invoke({ path: eof.path, maxChars: 1 }));
        const eofCursor = JSON.parse(eofFirst.nextCursor!) as Record<string, unknown>;
        eofCursor.offset = 2;
        const eofEmpty = output(await eof.invoke({
            path: eof.path,
            cursor: JSON.stringify(eofCursor),
            maxChars: 1,
        }));
        expect(eofEmpty.text).toBe('');
        expect(eofEmpty.range).toMatchObject({
            startLine: 2,
            endLine: 2,
            startOffset: 2,
            endOffset: 2,
            partialLine: false,
        });
        expect(eofEmpty.complete).toBe(true);
        expect(eofEmpty.endOfPart).toBe(true);
    });

    it('reports a completed requested line range without claiming the whole part is complete', async () => {
        const content = '---\ndate: 2026-01-01\n---\nfirst body\nsecond body\nthird body';
        const f = setup(content);
        const result = output(await f.invoke({ path: f.path, startLine: 4, endLine: 4 }));
        expect(result.text).toBe('first body\n');
        expect(result.range).toMatchObject({ startLine: 4, endLine: 4, partialLine: false });
        expect(result.truncated).toBe(false);
        expect(result.complete).toBe(true);
        expect(result.endOfPart).toBe(false);
        expect(result.nextCursor).toBeUndefined();
    });

    it('fits JSON-escaped text within the full result budget and always makes progress', async () => {
        const path = 'notes/"quoted".md';
        const text = Array.from({ length: 1800 }, () => '"\\\n').join('');
        const f = setup(text, { path });
        const result = output(await f.invoke({ path, maxChars: 4000 }));
        expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
        expect(result.text.length).toBeGreaterThan(0);
        expect(result.truncated).toBe(true);
        expect(result.nextCursor).toBeTruthy();
    });

    it('fails closed for missing size, oversized files, and real read failures', async () => {
        const missingSize = setup('body', { stat: { size: undefined } });
        const missing = await missingSize.invoke({ path: missingSize.path });
        expect(missing.ok).toBe(false);
        expect(missingSize.lookup).toHaveBeenCalledTimes(1);
        expect(missingSize.cachedRead).not.toHaveBeenCalled();

        const oversized = setup('x'.repeat(20), { stat: { size: 300_001 } });
        const over = await oversized.invoke({ path: oversized.path });
        expect(over.ok).toBe(false);
        expect(over.error).toContain('read limit');
        expect(oversized.cachedRead).not.toHaveBeenCalled();

        const failed = setup('body');
        failed.cachedRead.mockImplementationOnce(async () => {
            throw new Error('physical read failed');
        });
        await expect(failed.invoke({ path: failed.path })).rejects.toThrow('physical read failed');
    });

    it('rejects excluded and invalid paths before lookup, stat, cache, body parsing, and editor access', async () => {
        const f = setup('---\ndate: secret\n---\nsecret body');
        expect(() => f.tool.validateInput({ path: '../outside.md' })).toThrow('path traversal');
        expect(f.lookup).not.toHaveBeenCalled();
        expect(f.cachedRead).not.toHaveBeenCalled();
        for (const spy of Object.values(f.editor)) expect(spy).not.toHaveBeenCalled();

        expect(() => f.tool.validateInput({ path: 'notes/outside.txt' })).toThrow('unsupported file type');
        expect(() => f.tool.validateInput({ path: 'notes/a.md', part: 'properties', startLine: 1, endLine: 2 })).toThrow();
        expect(() => f.tool.validateInput({ path: 'notes/a.md', cursor: '{}', startLine: 1, endLine: 2 })).toThrow();
    });

    it('discards an in-flight read when the source lifetime is revoked', async () => {
        const f = setup('saved body');
        let release!: (content: string) => void;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        f.cachedRead.mockImplementationOnce(() => new Promise<string>(resolve => {
            release = resolve;
            entered();
        }));
        const reading = f.invoke({ path: f.path });
        await started;
        f.revoke();
        release('old text');
        await expect(reading).rejects.toThrow('no longer current');
    });

    it('discards text after an async hash when the source is revoked', async () => {
        const f = setup('saved body');
        const originalHash = computeContentHash as jest.Mock;
        let release!: (digest: string) => void;
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        originalHash.mockImplementationOnce(() => new Promise<string>(resolve => {
            release = resolve;
            entered();
        }));
        const reading = f.invoke({ path: f.path });
        await started;
        f.revoke();
        release('0'.repeat(40));
        await expect(reading).rejects.toThrow('no longer current');
    });

    it('rejects an old cursor after mtime or content changes', async () => {
        const f = setup(`${'x'.repeat(20)}\n`);
        const first = output(await f.invoke({ path: f.path, maxChars: 5 }));
        f.file.stat.mtime += 1;
        const staleMtime = await f.invoke({ path: f.path, cursor: first.nextCursor! });
        expect(staleMtime.ok).toBe(false);

        const second = setup(`${'x'.repeat(20)}\n`);
        const secondFirst = output(await second.invoke({ path: second.path, maxChars: 5 }));
        const oldMtime = second.file.stat.mtime;
        second.replaceContent(`${'y'.repeat(20)}\n`);
        second.file.stat.mtime = oldMtime;
        const staleContent = await second.invoke({ path: second.path, cursor: secondFirst.nextCursor! });
        expect(staleContent.ok).toBe(false);
    });

    it('rejects an old cursor for a replacement file object or another tool instance', async () => {
        const f = setup('x'.repeat(20));
        const first = output(await f.invoke({ path: f.path, maxChars: 5 }));
        const replacement = { ...f.file };
        f.replaceFile(replacement);
        const replacementResult = await f.invoke({ path: f.path, cursor: first.nextCursor! });
        expect(replacementResult.ok).toBe(false);

        const another = setup('x'.repeat(20), { path: f.path });
        const anotherResult = await another.invoke({ path: f.path, cursor: first.nextCursor! }, f.context);
        expect(anotherResult.ok).toBe(false);
    });

    it('strictly validates cursor structure and treats a valid offset change as an equivalent range request', async () => {
        const f = setup('x'.repeat(20));
        const first = output(await f.invoke({ path: f.path, maxChars: 5 }));
        const cursor = JSON.parse(first.nextCursor!) as Record<string, unknown>;

        const moved = output(await f.invoke({
            path: f.path,
            cursor: JSON.stringify({ ...cursor, offset: 10 }),
        }));
        expect(moved.text).toBe('x'.repeat(10));
        expect(moved.complete).toBe(true);

        for (const invalidCursor of [
            JSON.stringify({ ...cursor, extra: true }),
            JSON.stringify({ ...cursor, offset: 21 }),
            JSON.stringify({ ...cursor, path: 'notes/allowed.md' }),
            JSON.stringify({ ...cursor, sourceVersion: '0'.repeat(40) }),
            'not-json',
        ]) {
            const result = await f.invoke({ path: f.path, cursor: invalidCursor });
            expect(result.ok).toBe(false);
            expect(result.content).toBeNull();
        }
    });

    it('rejects a cursor moved into the middle of a surrogate pair', async () => {
        const f = setup('a😀b');
        const first = output(await f.invoke({ path: f.path, maxChars: 1 }));
        const cursor = JSON.parse(first.nextCursor!) as Record<string, unknown>;
        const validMoved = output(await f.invoke({
            path: f.path,
            cursor: JSON.stringify({ ...cursor, offset: 3 }),
            maxChars: 1,
        }));
        expect(validMoved.text).toBe('b');

        const invalid = await f.invoke({
            path: f.path,
            cursor: JSON.stringify({ ...cursor, offset: 2 }),
            maxChars: 1,
        });
        expect(invalid.ok).toBe(false);
        expect(invalid.content).toBeNull();
    });

    it('continues a large multi-line escaped body without losing content or exceeding JSON budget', async () => {
        const source = Array.from({ length: 13_333 }, () => '"\\\n').join('');
        const f = setup(source);
        let text = '';
        let result = output(await f.invoke({ path: f.path, maxChars: 4000 }));
        text += result.text;
        for (let page = 0; page < 30 && result.nextCursor; page += 1) {
            expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
            result = output(await f.invoke({
                path: f.path,
                cursor: result.nextCursor,
                maxChars: 4000,
            }));
            text += result.text;
        }
        expect(JSON.stringify(result).length).toBeLessThanOrEqual(6000);
        expect(result.complete).toBe(true);
        expect(result.endOfPart).toBe(true);
        expect(result.nextCursor).toBeUndefined();
        expect(text).toBe(source);
    });

    it('reads the saved path even when the active editor points at another note', async () => {
        const f = setup('saved path body');
        const result = output(await f.invoke({ path: f.path }));
        expect(result.text).toBe('saved path body');
        expect(f.editor.getValue).not.toHaveBeenCalled();
        expect(f.editor.getSelection).not.toHaveBeenCalled();
    });

    it('keeps visible provenance through result.sources and the capability adapter', async () => {
        const f = setup('source body');
        const result = await f.invoke({ path: f.path });
        expect(result.sources).toEqual([expect.objectContaining({ path: f.path,
            observedRevision: { state: 'identified', basis: 'vault_read',
                digest: { algorithm: 'sha1', scope: 'whole_file', value: await computeContentHash('source body') },
                stat: { mtime: 101, size: 11 } } })]);
        const adapted = chatToolResultToAgentCapabilityResult(
            f.tool,
            'test-provider',
            result,
        );
        expect(adapted.sources).toEqual(result.sources);
        expect(adapted.sourceRecords).toEqual([
            expect.objectContaining({ path: f.path, sourceBoundary: 'read-only-tool',
                observedRevision: result.sources[0].observedRevision }),
        ]);
    });
});
