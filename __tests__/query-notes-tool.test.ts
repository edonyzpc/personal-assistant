import { getAllTags } from 'obsidian';
import type { AiServiceHost } from '../src/ai-services/AiServiceHost';
import { chatToolResultToAgentCapabilityResult } from '../src/ai-services/capability-adapter';
import { createQueryNotesTool } from '../src/ai-services/chat-tool-factories';
import { isQueryNotesResult } from '../src/ai-services/chat-tool-guards';
import type {
    ChatToolContext,
    ChatToolResult,
    QueryNotesInput,
    QueryNotesOutput,
} from '../src/ai-services/chat-tool-types';
import { QUERY_NOTES_PROJECTION_MAX_UTF8_BYTES } from '../src/ai-services/chat-tool-constants';
import { computeContentHash } from '../src/vss-helpers';

jest.mock('obsidian', () => {
    const base = jest.requireActual('../__mocks__/obsidian') as Record<string, unknown>;
    return {
        ...base,
        getAllTags: jest.fn((cache: {
            tags?: Array<{ tag?: string }>;
            frontmatter?: { tags?: unknown; tag?: unknown };
        }) => {
            const inline = (cache.tags ?? [])
                .map(entry => entry.tag)
                .filter((tag): tag is string => typeof tag === 'string');
            const frontmatterValue = cache.frontmatter?.tags;
            const frontmatterTags = Array.isArray(frontmatterValue)
                ? frontmatterValue.filter((tag): tag is string => typeof tag === 'string')
                : typeof frontmatterValue === 'string' ? [frontmatterValue] : [];
            return [...inline, ...frontmatterTags];
        }),
    };
});

jest.mock('../src/vss-helpers', () => ({
    computeContentHash: jest.fn(async (input: string) => {
        const { createHash } = jest.requireActual('node:crypto') as typeof import('node:crypto');
        return createHash('sha1').update(input, 'utf8').digest('hex');
    }),
}));

interface FileFixture {
    path: string;
    name: string;
    basename: string;
    extension: string;
    stat: { ctime: number; mtime: number; size: number };
}

interface CacheFixture {
    tags?: Array<{ tag?: string }>;
    frontmatter?: Record<string, unknown>;
}

function makeFile(path: string, stat: Partial<FileFixture['stat']> = {}): FileFixture {
    const name = path.split('/').pop()!;
    return {
        path,
        name,
        basename: name.replace(/\.md$/, ''),
        extension: 'md',
        stat: { ctime: 1, mtime: 2, size: 10, ...stat },
    };
}

function setup(files: FileFixture[], caches = new Map<string, CacheFixture>()) {
    let currentFiles = [...files];
    let current = true;
    const allowed = new Set(files.map(file => file.path));
    const getMarkdownFiles = jest.fn(() => currentFiles.filter(file => file.extension === 'md'));
    const cache = jest.fn((file: FileFixture) => caches.get(file.path) ?? null);
    const cachedRead = jest.fn(async () => {
        throw new Error('query_notes must not read note bodies');
    });
    const metadata = { getFileCache: cache };
    const host = {
        app: {
            vault: { getMarkdownFiles, cachedRead },
            metadataCache: metadata,
        },
    } as unknown as AiServiceHost;
    const context: ChatToolContext = {
        host,
        taskSourceReadGuard: {
            isCurrent: () => current,
            isPathAllowed: (path: string) => allowed.has(path),
        },
    };
    const tool = createQueryNotesTool();
    const invoke = (raw: Record<string, unknown>, invokeContext: ChatToolContext = context) =>
        tool.execute(tool.validateInput(raw), invokeContext);
    return {
        tool,
        context,
        invoke,
        allowed,
        getMarkdownFiles,
        cache,
        cachedRead,
        caches,
        setFiles: (next: FileFixture[]) => { currentFiles = next; },
        replaceFile: (path: string, replacement: FileFixture) => {
            currentFiles = currentFiles.map(file => file.path === path ? replacement : file);
        },
        revoke: () => { current = false; },
    };
}

function output(result: ChatToolResult<QueryNotesOutput>): QueryNotesOutput {
    expect(result.ok).toBe(true);
    expect(result.content).toBeTruthy();
    expect(isQueryNotesResult(result.content)).toBe(true);
    return result.content!;
}

function paths(result: QueryNotesOutput): string[] {
    return result.matches.map(match => match.path);
}

describe('createQueryNotesTool', () => {
    it('combines exact path/folder, all-of tags, and strict property conditions', async () => {
        const files = [
            makeFile('notes/a.md', { ctime: 100, mtime: 200 }),
            makeFile('notes/sub/b.md', { ctime: 300, mtime: 400 }),
            makeFile('notebook/c.md'),
        ];
        const caches = new Map([
            ['notes/a.md', {
                tags: [{ tag: '#Project' }],
                frontmatter: { status: 'active', priority: null, numbers: [1, 2] },
            }],
            ['notes/sub/b.md', {
                tags: [{ tag: '#project/sub' }],
                frontmatter: { status: 'active', priority: null, numbers: ['2'] },
            }],
            ['notebook/c.md', { frontmatter: { status: 'inactive' } }],
        ]);
        const f = setup(files, caches);
        const result = output(await f.invoke({
            folder: 'notes',
            tags: ['Project'],
            properties: [
                { key: 'priority', operator: 'exists' },
                { key: 'status', operator: 'equals', value: 'active' },
                { key: 'numbers', operator: 'contains', value: 2 },
            ],
        }));
        expect(paths(result)).toEqual(['notes/a.md']);
        expect(result.matchCount).toBe(1);
        expect(result.matchCountKind).toBe('exact');
        expect(result.coverage).toEqual(expect.objectContaining({ state: 'complete', evaluatedCandidates: 2 }));
        expect(result.matches[0]).toEqual({ path: 'notes/a.md', title: 'a' });
        expect(new Set(f.cache.mock.calls.map(([file]) => file.path))).toEqual(new Set(['notes/a.md', 'notes/sub/b.md']));
        expect(f.cache).toHaveBeenCalledTimes(4);
        expect(f.cachedRead).not.toHaveBeenCalled();

        const andScope = output(await f.invoke({ path: 'notebook/c.md', folder: 'notes' }));
        expect(andScope.matchCount).toBe(0);
        expect(andScope.matchCountKind).toBe('exact');
    });

    it('uses explicit ctime/mtime boundaries without cross-field fallback', async () => {
        const files = [
            makeFile('z.md', { ctime: 100, mtime: 900 }),
            makeFile('a.md', { ctime: 199, mtime: 300 }),
            makeFile('b.md', { ctime: 200, mtime: 100 }),
        ];
        const f = setup(files);
        const created = output(await f.invoke({
            date: {
                field: 'ctime',
                kind: 'timestamp',
                from: '1970-01-01T00:00:00.100Z',
                to: '1970-01-01T00:00:00.200Z',
            },
        }));
        expect(paths(created)).toEqual(['a.md', 'z.md']);
        const modified = output(await f.invoke({
            date: {
                field: 'mtime',
                kind: 'timestamp',
                from: '1970-01-01T00:00:00.300Z',
                to: '1970-01-01T00:00:00.901Z',
            },
        }));
        expect(paths(modified)).toEqual(['a.md', 'z.md']);
        expect(modified.matches[0]).toEqual(expect.objectContaining({ mtime: 300 }));
        expect(modified.matches[1]).toEqual(expect.objectContaining({ mtime: 900 }));
    });

    it('records host-only dependencies for every evaluated path, stat, and nonmatch candidate', async () => {
        const files = [
            makeFile('a.md', { ctime: 10 }),
            makeFile('b.md', { ctime: 20 }),
        ];
        const f = setup(files);
        const exactResult = await f.invoke({ path: 'a.md' });
        const exact = output(exactResult);
        expect(exact.matchCount).toBe(1);
        expect(exactResult.sourceRecords?.map(record => record.path)).toEqual(['a.md']);

        const stat = output(await f.invoke({
            sort: { field: 'ctime', direction: 'asc' },
            limit: 1,
        }));
        expect(stat.matchCount).toBe(2);
        expect(paths(stat)).toEqual(['a.md']);
        const statResult = await f.invoke({
            sort: { field: 'ctime', direction: 'asc' },
            limit: 1,
        });
        expect(statResult.sources).toEqual([{ path: 'a.md' }]);
        expect(statResult.sourceRecords?.map(record => record.path)).toEqual(['a.md', 'b.md']);
        const adapted = chatToolResultToAgentCapabilityResult(f.tool, 'test-provider', statResult);
        expect(adapted.sources).toEqual([{ path: 'a.md' }]);
        expect(adapted.sourceRecords?.map(record => record.path).sort()).toEqual(['a.md', 'a.md', 'b.md']);
        expect(adapted.sourceRecords?.every(record => record.path !== 'b.md'
            || record.metadata?.sourceDependency === true)).toBe(true);
        expect(f.cache).not.toHaveBeenCalled();

        const nonmatchFiles = [makeFile('notes/a.md', { ctime: 0 }), makeFile('outside/b.md')];
        const nonmatch = setup(nonmatchFiles);
        const nonmatchResult = output(await nonmatch.invoke({
            folder: 'notes',
            date: {
                field: 'ctime',
                kind: 'timestamp',
                from: '2026-01-01T00:00:00Z',
                to: '2026-01-02T00:00:00Z',
            },
        }));
        expect(nonmatchResult.matchCount).toBe(0);
        expect(nonmatchResult.matchCountKind).toBe('exact');
        const rawNonmatch = await nonmatch.invoke({
            folder: 'notes',
            date: {
                field: 'ctime',
                kind: 'timestamp',
                from: '2026-01-01T00:00:00Z',
                to: '2026-01-02T00:00:00Z',
            },
        });
        expect(rawNonmatch.sources).toEqual([]);
        expect(rawNonmatch.sourceRecords?.map(record => record.path)).toEqual(['notes/a.md']);
    });

    it('lets a definite false date dominate unknown tags and keeps exact zero', async () => {
        const f = setup([makeFile('note.md', { ctime: 0 })]);
        const result = output(await f.invoke({
            tags: ['x'],
            date: {
                field: 'ctime',
                kind: 'timestamp',
                from: '2026-01-01T00:00:00Z',
                to: '2026-01-02T00:00:00Z',
            },
        }));
        expect(result.matchCount).toBe(0);
        expect(result.matchCountKind).toBe('exact');
        expect(result.coverage.state).toBe('complete');
        expect(result.coverage.cacheUnknown).toBeUndefined();
        expect(result.nextCursor).toBeUndefined();
    });

    it('treats a missing tag cache as unknown instead of matching every requested tag', async () => {
        const missingCache = setup([makeFile('missing-cache.md')]);
        const result = output(await missingCache.invoke({ tags: ['missing'], limit: 1 }));
        expect(result.matchCount).toBe(0);
        expect(result.matchCountKind).toBe('lower-bound');
        expect(result.coverage).toEqual(expect.objectContaining({
            state: 'partial',
            cacheUnknown: true,
        }));
        expect(result.nextCursor).toBeUndefined();

        const knownCache = setup(
            [makeFile('no-tags.md')],
            new Map([['no-tags.md', {}]]),
        );
        const nonmatch = output(await knownCache.invoke({ tags: ['missing'], limit: 1 }));
        expect(nonmatch.matchCount).toBe(0);
        expect(nonmatch.matchCountKind).toBe('exact');
        expect(nonmatch.coverage.state).toBe('complete');
        expect(nonmatch.nextCursor).toBeUndefined();
    });

    it('ignores unknown sort values for candidates excluded by a definite condition', async () => {
        const f = setup([makeFile('note.md', { ctime: undefined, mtime: 2 })]);
        const result = output(await f.invoke({
            sort: { field: 'ctime', direction: 'asc' },
            date: {
                field: 'mtime',
                kind: 'timestamp',
                from: '2026-01-01T00:00:00Z',
                to: '2026-01-02T00:00:00Z',
            },
        }));
        expect(result.matchCount).toBe(0);
        expect(result.matchCountKind).toBe('exact');
        expect(result.coverage.state).toBe('complete');
    });

    it('requires explicit timezone timestamps and real calendar dates', () => {
        const tool = createQueryNotesTool();
        expect(() => tool.validateInput({
            date: { field: 'ctime', kind: 'timestamp', from: '2026-01-01', to: '2026-01-02' },
        })).toThrow(/UTC offset/);
        expect(() => tool.validateInput({
            date: { field: 'ctime', kind: 'timestamp', from: '2026-02-30T00:00:00Z', to: '2026-03-01T00:00:00Z' },
        })).toThrow(/real ISO/);
        expect(() => tool.validateInput({
            date: { field: 'property', property: 'date', kind: 'calendar-date', from: '2026-02-30', to: '2026-03-01' },
        })).toThrow(/real YYYY-MM-DD/);
        expect(() => tool.validateInput({
            date: { field: 'mtime', kind: 'calendar-date', from: '2026-02-01', to: '2026-03-01' },
        })).toThrow(/timestamp semantics/);
    });

    it('distinguishes property timestamp and calendar-date semantics', async () => {
        const files = [
            makeFile('timestamp.md'),
            makeFile('calendar.md'),
            makeFile('missing.md'),
            makeFile('invalid.md'),
        ];
        const caches = new Map([
            ['timestamp.md', { frontmatter: { when: '2026-01-01T08:00:00+08:00' } }],
            ['calendar.md', { frontmatter: { when: '2026-01-01' } }],
            ['invalid.md', { frontmatter: { when: '01/01/2026' } }],
        ]);
        const f = setup(files, caches);
        const timestamp = output(await f.invoke({
            date: {
                field: 'property',
                property: 'when',
                kind: 'timestamp',
                from: '2026-01-01T00:00:00Z',
                to: '2026-01-01T00:00:01Z',
            },
        }));
        expect(paths(timestamp)).toEqual(['timestamp.md']);
        const calendar = output(await f.invoke({
            date: {
                field: 'property',
                property: 'when',
                kind: 'calendar-date',
                from: '2026-01-01',
                to: '2026-01-02',
            },
        }));
        expect(paths(calendar)).toEqual(['calendar.md']);
        const invalid = output(await f.invoke({
            date: {
                field: 'property',
                property: 'when',
                kind: 'calendar-date',
                from: '2026-01-01',
                to: '2026-01-03',
            },
        }));
        expect(invalid.matchCount).toBe(1);
        expect(invalid.matchCountKind).toBe('lower-bound');
        expect(invalid.coverage.state).toBe('partial');
        expect(invalid.nextCursor).toBeUndefined();
    });

    it('keeps a definite AND false exact even when unrelated cache data is unknown', async () => {
        const files = [makeFile('false.md')];
        const caches = new Map([
            ['false.md', { frontmatter: { status: 'inactive', when: 'not-a-date' } }],
        ]);
        const f = setup(files, caches);
        const result = output(await f.invoke({
            properties: [
                { key: 'status', operator: 'equals', value: 'active' },
            ],
            date: {
                field: 'property',
                property: 'when',
                kind: 'calendar-date',
                from: '2026-01-01',
                to: '2026-01-02',
            },
        }));
        expect(result.matchCount).toBe(0);
        expect(result.matchCountKind).toBe('exact');
        expect(result.coverage.state).toBe('complete');
        expect(f.cache).toHaveBeenCalledTimes(2);
    });

    it('returns exact zero for an allowed missing path without cache or body reads', async () => {
        const f = setup([makeFile('other.md')]);
        const result = output(await f.invoke({ path: 'notes/missing.md' }));
        expect(result.matchCount).toBe(0);
        expect(result.matchCountKind).toBe('exact');
        expect(result.coverage.evaluatedCandidates).toBe(0);
        expect(f.cache).not.toHaveBeenCalled();
        expect(f.cachedRead).not.toHaveBeenCalled();
    });

    it('pages every match once with deterministic same-time path order and changed limits', async () => {
        const files = [
            makeFile('c.md', { mtime: 100 }),
            makeFile('a.md', { mtime: 100 }),
            makeFile('b.md', { mtime: 100 }),
        ];
        const f = setup(files);
        const first = output(await f.invoke({
            sort: { field: 'mtime', direction: 'desc' },
            limit: 2,
        }));
        expect(paths(first)).toEqual(['a.md', 'b.md']);
        const second = output(await f.invoke({
            sort: { field: 'mtime', direction: 'desc' },
            limit: 1,
            cursor: first.nextCursor!,
        }));
        expect(paths(second)).toEqual(['c.md']);
        expect(second.nextCursor).toBeUndefined();
    });

    it('continues deterministically when the public API enumeration order changes', async () => {
        const firstFile = makeFile('a.md');
        const secondFile = makeFile('b.md');
        const f = setup([firstFile, secondFile]);
        const first = output(await f.invoke({ limit: 1 }));
        expect(paths(first)).toEqual(['a.md']);

        f.setFiles([secondFile, firstFile]);
        const second = output(await f.invoke({ limit: 1, cursor: first.nextCursor! }));
        expect(paths(second)).toEqual(['b.md']);
        expect(second.nextCursor).toBeUndefined();
    });

    it('invalidates cursors for query, sort, cache, file identity, and permission changes', async () => {
        const file = makeFile('note.md');
        const other = makeFile('other.md');
        const caches = new Map([
            ['note.md', { frontmatter: { status: 'active' } }],
            ['other.md', { frontmatter: { status: 'active' } }],
        ]);
        const f = setup([file, other], caches);
        const first = output(await f.invoke({
            properties: [{ key: 'status', operator: 'equals', value: 'active' }],
            limit: 1,
        }));
        expect(first.matchCount).toBe(2);

        const expiredCursor = async (raw: Record<string, unknown>) => {
            const result = await f.invoke({ ...raw, cursor: first.nextCursor!, limit: 1 });
            expect(result.ok).toBe(false);
            expect(result.content).toBeNull();
            return result.error ?? '';
        };

        expect(await expiredCursor({
            properties: [{ key: 'status', operator: 'equals', value: 'inactive' }],
        })).toContain('different query');
        expect(await expiredCursor({
            properties: [{ key: 'status', operator: 'equals', value: 'active' }],
            sort: { field: 'mtime', direction: 'desc' },
        })).toContain('different query');

        caches.set('note.md', { frontmatter: { status: 'inactive' } });
        expect(await expiredCursor({
            properties: [{ key: 'status', operator: 'equals', value: 'active' }],
        })).toMatch(/snapshot|different query/);
        caches.set('note.md', { frontmatter: { status: 'active' } });

        f.replaceFile('note.md', makeFile('note.md'));
        expect(await expiredCursor({
            properties: [{ key: 'status', operator: 'equals', value: 'active' }],
        })).toMatch(/snapshot|different query/);

        f.setFiles([file]);
        expect(await expiredCursor({
            properties: [{ key: 'status', operator: 'equals', value: 'active' }],
        })).toMatch(/snapshot|different query/);

        f.setFiles([file, other]);
        f.allowed.clear();
        expect((await expiredCursor({
            properties: [{ key: 'status', operator: 'equals', value: 'active' }],
        })).length).toBeGreaterThan(0);
    });

    it('projects an own __proto__ property and invalidates its cursor when it is deleted', async () => {
        const makeFrontmatter = () => JSON.parse('{"__proto__":"yes"}') as Record<string, unknown>;
        const frontmatters = new Map([
            ['a.md', makeFrontmatter()],
            ['b.md', makeFrontmatter()],
            ['c.md', makeFrontmatter()],
        ]);
        const files = [...frontmatters.keys()].map(path => makeFile(path));
        const caches = new Map(
            [...frontmatters].map(([path, frontmatter]) => [path, { frontmatter }]),
        );
        const query = {
            properties: [{ key: '__proto__', operator: 'exists' as const }],
            limit: 1,
        };
        const f = setup(files, caches);
        const first = output(await f.invoke(query));
        expect(paths(first)).toEqual(['a.md']);

        const unchanged = output(await f.invoke({ ...query, cursor: first.nextCursor! }));
        expect(paths(unchanged)).toEqual(['b.md']);

        delete frontmatters.get('a.md')!.__proto__;
        const changed = await f.invoke({ ...query, cursor: first.nextCursor! });
        expect(changed.ok).toBe(false);
        expect(changed.content).toBeNull();
        expect(changed.error).toMatch(/snapshot|different query/);
    });

    it('revalidates the projection after asynchronous hashing', async () => {
        const file = makeFile('note.md');
        const other = makeFile('other.md');
        const caches = new Map([
            ['note.md', { frontmatter: { status: 'active' } }],
            ['other.md', { frontmatter: { status: 'active' } }],
        ]);
        const f = setup([file, other], caches);
        const first = output(await f.invoke({
            properties: [{ key: 'status', operator: 'equals', value: 'active' }],
            limit: 1,
        }));
        (computeContentHash as jest.Mock).mockImplementationOnce(async () => {
            caches.set('note.md', { frontmatter: { status: 'changed' } });
            return 'changed-during-hash';
        });
        const changedDuringHash = await f.invoke({
            properties: [{ key: 'status', operator: 'equals', value: 'active' }],
            limit: 1,
            cursor: first.nextCursor,
        });
        expect(changedDuringHash.ok).toBe(false);
        expect(changedDuringHash.error).toContain('different query');
    });

    it('returns a deterministic path-asc partial page without a cursor over the candidate cap', async () => {
        const files = Array.from({ length: 501 }, (_, index) => makeFile(`${String(index).padStart(3, '0')}.md`, { mtime: index }));
        const f = setup(files);
        const result = output(await f.invoke({
            sort: { field: 'mtime', direction: 'desc' },
            limit: 3,
        }));
        expect(paths(result)).toEqual(['000.md', '001.md', '002.md']);
        expect(result.matchCount).toBe(500);
        expect(result.matchCountKind).toBe('lower-bound');
        expect(result.coverage).toEqual(expect.objectContaining({
            state: 'partial',
            candidateCapExceeded: true,
            evaluatedCandidates: 500,
        }));
        expect(result.sort).toEqual({ field: 'path', direction: 'asc' });
        expect(result.nextCursor).toBeUndefined();
        expect(result.partialResultGuidance).toContain('Narrow the query');
    });

    it('counts the complete canonical snapshot JSON against the projection budget', async () => {
        const hashInputs: string[] = [];
        (computeContentHash as jest.Mock).mockImplementation(async (input: string) => {
            hashInputs.push(input);
            const { createHash } = jest.requireActual('node:crypto') as typeof import('node:crypto');
            return createHash('sha1').update(input, 'utf8').digest('hex');
        });
        try {
            // Keep the instance-prefix digit count stable across test ordering so
            // this exercises the snapshot boundary rather than identity length drift.
            for (let index = 0; index < 1_000; index += 1) createQueryNotesTool();
            const files = Array.from({ length: 500 }, (_, index) => makeFile(
                `${String(index).padStart(3, '0')}${'p'.repeat(index < 100 ? 191 : 190)}.md`,
            ));
            const f = setup(files);
            const result = output(await f.invoke({ limit: 1 }));
            expect(result.coverage).toEqual(expect.objectContaining({
                state: 'partial',
                projectionBudgetExceeded: true,
            }));
            expect(result.nextCursor).toBeUndefined();
            const hashedBytes = hashInputs.map(input => Buffer.byteLength(input, 'utf8'));
            expect(Math.max(...hashedBytes)).toBeLessThanOrEqual(QUERY_NOTES_PROJECTION_MAX_UTF8_BYTES);
        } finally {
            (computeContentHash as jest.Mock).mockImplementation(async (input: string) => {
                const { createHash } = jest.requireActual('node:crypto') as typeof import('node:crypto');
                return createHash('sha1').update(input, 'utf8').digest('hex');
            });
        }
    });

    it('still resolves an exact path found after the general candidate cap', async () => {
        const files = Array.from({ length: 501 }, (_, index) => makeFile(`${String(index).padStart(3, '0')}.md`));
        const f = setup(files);
        const result = output(await f.invoke({ path: '500.md' }));
        expect(paths(result)).toEqual(['500.md']);
        expect(result.matchCountKind).toBe('exact');
        expect(result.coverage.state).toBe('complete');
    });

    it('treats a file-named folder as a slash-bounded ancestor only', async () => {
        const files = [makeFile('a.md'), makeFile('a.md/b.md')];
        const f = setup(files);
        const result = output(await f.invoke({ folder: 'a.md' }));
        expect(paths(result)).toEqual(['a.md/b.md']);
        expect(result.matchCount).toBe(1);
        expect(result.matchCountKind).toBe('exact');
    });

    it('treats an oversized relevant property as partial rather than absent', async () => {
        const caches = new Map([['note.md', { frontmatter: { text: 'x'.repeat(20_000) } }]]);
        const f = setup([makeFile('note.md')], caches);
        const result = output(await f.invoke({
            properties: [{ key: 'text', operator: 'contains', value: 'needle' }],
        }));
        expect(result.matchCount).toBe(0);
        expect(result.matchCountKind).toBe('lower-bound');
        expect(result.coverage).toEqual(expect.objectContaining({
            state: 'partial',
            projectionBudgetExceeded: true,
            cacheUnknown: true,
        }));
        expect(result.nextCursor).toBeUndefined();
    });

    it('projects existence without recursively copying an unrelated complex value', async () => {
        const value: Record<string, unknown> = {};
        Object.defineProperty(value, 'deep', {
            enumerable: true,
            get() {
                throw new Error('query_notes must not traverse exists-only values');
            },
        });
        const caches = new Map([['note.md', { frontmatter: { blob: value } }]]);
        const f = setup([makeFile('note.md')], caches);
        const result = output(await f.invoke({
            properties: [{ key: 'blob', operator: 'exists' }],
        }));
        expect(result.matchCount).toBe(1);
        expect(result.matchCountKind).toBe('exact');
        expect(result.coverage.state).toBe('complete');
    });

    it('checks metadata strings and array lengths before serialization or member visits', async () => {
        const hugeString = 'x'.repeat(20_000);
        const stringify = jest.spyOn(JSON, 'stringify');
        const oversizedString = setup(
            [makeFile('huge-string.md')],
            new Map([['huge-string.md', { frontmatter: { text: hugeString } }]]),
        );
        const contains = output(await oversizedString.invoke({
            properties: [{ key: 'text', operator: 'contains', value: 'needle' }],
        }));
        expect(contains.matchCount).toBe(0);
        expect(contains.matchCountKind).toBe('lower-bound');
        expect(contains.coverage).toEqual(expect.objectContaining({
            state: 'partial',
            projectionBudgetExceeded: true,
            cacheUnknown: true,
        }));
        expect(stringify.mock.calls.some(([value]) => typeof value === 'string' && value.includes(hugeString))).toBe(false);

        const exists = output(await oversizedString.invoke({
            properties: [{ key: 'text', operator: 'exists' }],
        }));
        expect(exists.matchCount).toBe(1);
        expect(exists.matchCountKind).toBe('exact');
        expect(exists.coverage.state).toBe('complete');
        expect(stringify.mock.calls.some(([value]) => typeof value === 'string' && value.includes(hugeString))).toBe(false);
        stringify.mockRestore();

        const accessedIndexes: string[] = [];
        const longArray = new Proxy(Array.from({ length: 8_193 }, () => ({})), {
            get(target, property, receiver) {
                if (typeof property === 'string' && /^\d+$/.test(property)) {
                    accessedIndexes.push(property);
                }
                return Reflect.get(target, property, receiver);
            },
        }) as unknown[];
        const oversizedArray = setup(
            [makeFile('huge-array.md')],
            new Map([['huge-array.md', { frontmatter: { values: longArray } }]]),
        );
        const containsArray = output(await oversizedArray.invoke({
            properties: [{ key: 'values', operator: 'contains', value: 'needle' }],
        }));
        expect(containsArray.matchCount).toBe(0);
        expect(containsArray.matchCountKind).toBe('lower-bound');
        expect(containsArray.coverage).toEqual(expect.objectContaining({
            state: 'partial',
            projectionBudgetExceeded: true,
            cacheUnknown: true,
        }));
        expect(accessedIndexes).toEqual([]);

        const bounded = setup(
            [makeFile('bounded-array.md')],
            new Map([['bounded-array.md', { frontmatter: { values: [{ ignored: true }, 'yes', null] } }]]),
        );
        const boundedResult = output(await bounded.invoke({
            properties: [{ key: 'values', operator: 'contains', value: 'yes' }],
        }));
        expect(paths(boundedResult)).toEqual(['bounded-array.md']);
        expect(boundedResult.matchCountKind).toBe('exact');
        expect(boundedResult.coverage.state).toBe('complete');
    });

    it('rejects obviously oversized tag caches before calling getAllTags', async () => {
        const hugeTags = Array.from({ length: 20_000 }, () => ({ tag: '#x' }));
        const caches = new Map([['note.md', { tags: hugeTags }]]);
        const f = setup([makeFile('note.md')], caches);
        const callsBefore = (getAllTags as jest.Mock).mock.calls.length;
        const result = output(await f.invoke({ tags: ['project'] }));
        expect(result.matchCount).toBe(0);
        expect(result.matchCountKind).toBe('lower-bound');
        expect(result.coverage).toEqual(expect.objectContaining({
            state: 'partial',
            projectionBudgetExceeded: true,
            cacheUnknown: true,
        }));
        expect((getAllTags as jest.Mock).mock.calls.length).toBe(callsBefore);
        expect(f.cache).toHaveBeenCalledTimes(1);
    });

    it('applies the provider-facing result budget as JavaScript characters', async () => {
        const suffixes = ['甲', '乙'];
        const files = suffixes.map(suffix => makeFile(`${'笔'.repeat(1_000)}${suffix}.md`));
        const f = setup(files);
        const result = output(await f.invoke({ limit: 2 }));
        expect(result.matchCount).toBe(2);
        expect(result.matchCountKind).toBe('exact');
        expect(result.nextCursor).toBeUndefined();
        const serialized = JSON.stringify(result);
        expect(serialized.length).toBeLessThanOrEqual(6_000);
        expect(Buffer.byteLength(serialized, 'utf8')).toBeGreaterThan(6_000);
    });

    it('returns an explicit unavailable result when one complete match cannot fit the output budget', async () => {
        const longPath = `${'p'.repeat(5800)}.md`;
        const f = setup([makeFile(longPath)]);
        const result = await f.invoke({ limit: 1 });
        expect(result.ok).toBe(false);
        expect(result.content).toBeNull();
        expect(result.error).toContain('output budget');
    });

    it('fails closed when required public APIs are missing', async () => {
        const f = setup([makeFile('note.md')]);
        (f.context.host.app.vault as { getMarkdownFiles?: unknown }).getMarkdownFiles = undefined;
        const missingFiles = await f.invoke({});
        expect(missingFiles.ok).toBe(false);
        expect(missingFiles.content).toBeNull();

        const g = setup([makeFile('note.md')]);
        (g.context.host.app.metadataCache as { getFileCache?: unknown }).getFileCache = undefined;
        const missingCache = await g.invoke({
            properties: [{ key: 'status', operator: 'exists' }],
        });
        expect(missingCache.ok).toBe(false);
        expect(missingCache.content).toBeNull();
        expect(JSON.stringify(missingCache)).not.toContain('exact');
    });

    it('does not enumerate denied paths and rejects before reads after revocation', async () => {
        const files = [makeFile('allowed.md'), makeFile('denied.md')];
        const caches = new Map([
            ['allowed.md', { frontmatter: { status: 'active' } }],
            ['denied.md', { frontmatter: { status: 'active' } }],
        ]);
        const f = setup(files, caches);
        f.allowed.delete('denied.md');
        const deniedStat = jest.fn(() => {
            throw new Error('Denied statistics read');
        });
        Object.defineProperty(files[1], 'stat', { get: deniedStat });
        const result = output(await f.invoke({
            properties: [{ key: 'status', operator: 'exists' }],
        }));
        expect(paths(result)).toEqual(['allowed.md']);
        expect(f.cache).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(result)).not.toContain('denied.md');
        expect(deniedStat).not.toHaveBeenCalled();

        const statResult = output(await f.invoke({
            date: {
                field: 'ctime',
                kind: 'timestamp',
                from: '1970-01-01T00:00:00Z',
                to: '1970-01-02T00:00:00Z',
            },
        }));
        expect(paths(statResult)).toEqual(['allowed.md']);
        expect(JSON.stringify(statResult)).not.toContain('denied.md');
        expect(deniedStat).not.toHaveBeenCalled();


        f.revoke();
        await expect(f.invoke({ path: 'allowed.md' })).rejects.toThrow(/no longer current/);
        expect(f.getMarkdownFiles.mock.calls.length).toBe(4);
    });

    it('keeps visible matches separate from host-only dependencies through the adapter', async () => {
        const files = [makeFile('match.md'), makeFile('nonmatch.md')];
        const caches = new Map([
            ['match.md', { frontmatter: { status: 'active' } }],
            ['nonmatch.md', { frontmatter: { status: 'inactive' } }],
        ]);
        const f = setup(files, caches);
        const result = await f.invoke({
            properties: [{ key: 'status', operator: 'equals', value: 'active' }],
        });
        expect(result.sources).toEqual([{ path: 'match.md' }]);
        expect(result.sourceRecords?.map(record => record.path).sort()).toEqual(['match.md', 'nonmatch.md']);
        const adapted = chatToolResultToAgentCapabilityResult(f.tool, 'test-provider', result);
        expect(adapted.sources).toEqual([{ path: 'match.md' }]);
        expect(adapted.sourceRecords?.map(record => record.path).sort())
            .toEqual(['match.md', 'match.md', 'nonmatch.md']);
        expect(adapted.sourceRecords?.every(record => record.path !== 'nonmatch.md'
            || record.metadata?.sourceDependency === true)).toBe(true);
    });
});
