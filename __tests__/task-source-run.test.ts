import type { Workspace } from 'obsidian';
import type { MarkdownViewLike, VaultFileLike } from '../src/ai-services/chat-tool-execution-helpers';
import type { ParsedBufferedToolCall } from '../src/ai-services/pa-agent-types';
import type { TaskSourceConstraint } from '../src/ai-services/task-source-constraint';
import type { ChatMessage, PaAgentMessage } from '../src/ai-services/chat-types';
import { createTaskSourceConstrainedExecutor, DECLARE_SOURCE_SCOPE } from '../src/ai-services/task-source-executor';
import {
    MAX_TASK_SOURCE_NOTE_DIRECTORY_CHARS,
    MAX_TASK_SOURCE_NOTE_HANDLES,
    TaskSourceRun,
    type TaskSourceRunHost,
} from '../src/ai-services/task-source-run';

jest.mock('obsidian');

function fixture(currentPath = 'notes/a.md') {
    const a: VaultFileLike = { path: currentPath };
    const b: VaultFileLike = { path: 'notes/b.md' };
    const canvas: VaultFileLike = { path: 'notes/board.canvas' };
    const files = new Map<string, VaultFileLike>([[a.path, a], [b.path, b], [canvas.path, canvas]]);
    let active: MarkdownViewLike | null = { file: a };
    let current = true;
    const workspace = {
        getActiveViewOfType: jest.fn((_type: unknown) => active),
        getMostRecentLeaf: jest.fn(() => null),
        getLeavesOfType: jest.fn((_type: string) => []),
    } as unknown as Workspace;
    const getFileByPath = jest.fn((path: string): unknown => files.get(path));
    const host: TaskSourceRunHost = { runId: 'run-1', userMessageId: 'user-1', userText: '只用当前笔记',
        workspace, getFileByPath, isCurrent: () => current };
    return { a, b, canvas, files, host, getFileByPath,
        create: () => new TaskSourceRun(host),
        setActive(view: MarkdownViewLike | null) { active = view; },
        setCurrent(value: boolean) { current = value; },
    };
}

function contextNotes(run: TaskSourceRun): { currentNoteHandle: string | null; notes: { handle: string; path: string }[] } {
    return JSON.parse(run.contextInstruction().split('\n').slice(-1)[0]);
}

function prepare(run: TaskSourceRun, input: Record<string, unknown> = {}): TaskSourceConstraint {
    const result = run.state.prepareDeclaration({ instructionQuote: '只用当前笔记', notes: 'current_note', webAllowed: false, ...input });
    if (!result.ok) throw new Error(result.reason);
    return result.constraint;
}

function commit(run: TaskSourceRun, input: Record<string, unknown> = {}): TaskSourceConstraint {
    const constraint = prepare(run, input);
    if (!run.state.commit(constraint)) throw new Error('Fixture did not commit');
    return constraint;
}

function call(id: string, name: string, input: unknown = {}): ParsedBufferedToolCall {
    return { type: 'toolCall', id, name, input, index: 0 };
}

function executorFor(run: TaskSourceRun) {
    const execute = jest.fn(async () => ({ outcome: 'success' as const, promptText: 'unused' }));
    const prepareBatch = jest.fn(async () => undefined);
    const executor = createTaskSourceConstrainedExecutor({
        baseExecutor: { execute, prepareBatch }, state: run.state,
        resolveHostNoteId: run.resolveNoteId, isHostCurrent: run.isCurrent,
        resolveReadPlans: run.resolveReadPlans, resolveNoteSearchScope: run.resolveNoteSearchScope,
    });
    return { execute, prepareBatch, preflight: (toolCalls: ParsedBufferedToolCall[]) => executor.preflightBatch!({
        runId: 'run-1', turnId: 'turn-1', turnIndex: 0, userInput: '只用当前笔记', toolCalls,
    }) };
}

describe('Task source run host', () => {
    it('projects known historical sources, retains legacy choices, and restores reauthorized history in a later run', () => {
        const h = fixture();
        const fromNote = (path: string): ChatMessage => ({ role: 'assistant', content: path === h.a.path ? 'A_FACT_AND_PROPOSAL' : 'B_FACT',
            memoryMetadata: { hasMemoryContent: false, allowedMemorySourcePaths: [], sourceRecords: [
                { kind: 'context-used', dedupKey: path, path, sourceBoundary: 'read-only-tool' },
            ] } });
        const history: ChatMessage[] = [fromNote(h.a.path), fromNote(h.b.path),
            { role: 'assistant', content: 'legacy first and second choices' }, { role: 'user', content: 'use the second' }];
        const run = h.create();
        expect(run.projectHistory(history)).toEqual(history);
        commit(run, { notes: 'selected', noteHandles: ['note_2'] });
        expect(run.projectHistory(history)).toEqual(history.slice(1));
        expect(history[0].content).toBe('A_FACT_AND_PROPOSAL');
        // The next real request may authorize A again; no persisted history is deleted.
        expect(h.create().projectHistory(history)).toEqual(history);
    });

    it('honors Memory off for legacy retrieval history without removing ordinary conversation', () => {
        const h = fixture();
        let enabled = true;
        const run = new TaskSourceRun({ ...h.host, isMemoryAllowed: () => enabled });
        const history: ChatMessage[] = [
            { role: 'assistant', content: 'MEMORY_FACT', memoryMetadata: { hasMemoryContent: true,
                allowedMemorySourcePaths: [h.a.path] } },
            { role: 'assistant', content: 'ordinary alternatives' },
        ];
        expect(run.projectHistory(history)).toEqual(history);
        enabled = false;
        expect(run.projectHistory(history)).toEqual(history.slice(1));
        enabled = true;
        expect(run.projectHistory(history)).toEqual(history);
    });

    it.each(['disabled', 'deleted'] as const)('uses canonical Memory identity without a boundary field when %s', reason => {
        const h = fixture();
        if (reason === 'deleted') h.files.delete(h.a.path);
        const run = new TaskSourceRun({ ...h.host, isMemoryAllowed: () => reason !== 'disabled' });
        const history: ChatMessage[] = [{ role: 'assistant', content: 'OLD_CANONICAL_MEMORY',
            canonicalTurn: { schemaVersion: 1, runId: 'old-run', turnId: 'old-turn', messages: [],
                sourceRecords: [{ kind: 'memory-reference', dedupKey: 'memory-a', path: h.a.path }] },
            // Canonical metadata owns this record; a stale empty fallback cannot clear it.
            memoryMetadata: { hasMemoryContent: false, allowedMemorySourcePaths: [] },
        }, { role: 'assistant', content: 'still-valid alternatives' }];
        expect(run.projectHistory(history)).toEqual(history.slice(1));
    });

    it.each(['deleted', 'replaced', 'excluded'] as const)('removes %s evidence and its metadata without editing conversation history', reason => {
        const h = fixture();
        const run = h.create();
        run.resolveNoteId(h.b.path);
        commit(run, { notes: 'vault' });
        const result: PaAgentMessage = {
            role: 'toolResult', id: 'result-a', toolCallId: 'call-a', toolName: 'read_note_outline',
            timestamp: 1, isError: false, content: {
                promptText: 'OLD_BODY', previewText: 'OLD_PREVIEW', includeInNextPrompt: true,
                metadata: { secret: 'OLD_METADATA' }, contextUsed: [{ category: 'current-note', label: 'OLD_LABEL' }],
                sourceRecords: [{ kind: 'context-used', dedupKey: 'a', sourceBoundary: 'read-only-tool', path: h.a.path }],
            },
        };
        const user: PaAgentMessage = { role: 'user', id: 'user', timestamp: 0, content: '采用第二个方案' };
        const assistant: PaAgentMessage = { role: 'assistant', id: 'assistant', timestamp: 0,
            content: [{ type: 'text', text: '方案一；方案二' }] };
        expect(run.projectTranscript([result])[0]).toBe(result);
        if (reason === 'deleted') h.files.delete(h.a.path);
        if (reason === 'replaced') h.files.set(h.a.path, { path: h.a.path });
        if (reason === 'excluded') commit(run, { notes: 'selected', noteHandles: ['note_2'] });
        const projected = run.projectTranscript([user, assistant, result]);
        expect(projected[0]).toBe(user);
        expect(projected[1]).toBe(assistant);
        expect(JSON.stringify(projected)).not.toContain('OLD_');
        expect(result.content.promptText).toBe('OLD_BODY');
        expect(projected[2]).toMatchObject({ role: 'toolResult', toolCallId: 'call-a',
            content: { metadata: { statusOnly: true } } });
    });

    it('captures only current identity and path, without body, metadata or vault enumeration', () => {
        const h = fixture();
        const forbiddenRead = jest.fn(() => { throw new Error('No source contents or enumeration'); });
        for (const property of ['basename', 'name', 'extension', 'stat']) {
            Object.defineProperty(h.a, property, { get: forbiddenRead });
        }
        const view = { file: h.a };
        Object.defineProperty(view, 'editor', { get: forbiddenRead });
        h.setActive(view);
        for (const property of ['getMarkdownFiles', 'read', 'cachedRead', 'metadataCache']) {
            Object.defineProperty(h.host, property, { get: forbiddenRead });
        }
        const run = h.create();
        const { resolveNoteId, contextInstruction } = run;
        const data = JSON.parse(contextInstruction().split('\n').slice(-1)[0]);
        expect(data).toEqual({ currentNoteHandle: 'note_1', notes: [{ handle: 'note_1', path: h.a.path }] });
        expect(resolveNoteId(h.a.path)).toBe('run-1:note:1');
        expect(h.getFileByPath.mock.calls.every(([path]) => path === h.a.path)).toBe(true);
        expect(forbiddenRead).not.toHaveBeenCalled();
        expect(run.state.snapshot()).toBeUndefined();
    });

    it('copies the original run and message fields before host lookups and preserves method bindings', () => {
        const h = fixture();
        h.host.getFileByPath = function (this: TaskSourceRunHost, path: string) {
            expect(this).toBe(h.host);
            this.runId = 'changed-run';
            this.userMessageId = 'changed-message';
            this.userText = 'new instruction';
            return h.files.get(path);
        };
        h.host.isCurrent = function (this: TaskSourceRunHost) { expect(this).toBe(h.host); return true; };
        const run = h.create();
        const snapshot = commit(run);
        expect(snapshot).toMatchObject({ runId: 'run-1', userMessageId: 'user-1', allowedNoteIds: ['run-1:note:1'] });
        expect(run.state.matchesRun('run-1', '只用当前笔记')).toBe(true);
        expect(run.state.matchesRun('changed-run', 'new instruction')).toBe(false);
    });

    it('registers discovered Markdown and Canvas files without changing the committed authorization', () => {
        const h = fixture();
        const run = h.create();
        const snapshot = commit(run);
        const bId = run.resolveNoteId(h.b.path)!;
        const canvasId = run.resolveNoteId(h.canvas.path)!;
        expect(bId).toBeDefined();
        expect(canvasId).toBeDefined();
        expect(run.resolveNoteId(h.b.path)).toBe(bId);
        expect(contextNotes(run).notes.map(note => note.path)).toEqual([h.a.path]);
        expect(run.state.snapshot()).toBe(snapshot);
        expect(run.state.allows({ kind: 'note', noteId: bId })).toBe(false);
        expect(run.state.allows({ kind: 'note', noteId: canvasId })).toBe(false);
        expect(run.state.registerNoteHandle('note_1', bId)).toBe(false);
        expect(run.state.prepareDeclaration({ instructionQuote: '只用当前笔记', notes: 'selected',
            noteHandles: ['note_2'], webAllowed: false })).toEqual({ ok: false, reason: 'scope_widening' });
    });

    it.each(['missing', 'wrong_path', 'folder', 'image', 'unstable_object', 'lookup_error'] as const)
    ('rejects %s discovery without publishing a handle', failure => {
        const h = fixture();
        const run = h.create();
        const path = failure === 'image' ? 'notes/image.png' : h.b.path;
        h.getFileByPath.mockImplementation(requested => {
            if (requested === h.a.path) return h.a;
            if (failure === 'lookup_error') throw new Error('lookup unavailable');
            if (failure === 'missing') return undefined;
            if (failure === 'wrong_path') return h.a;
            if (failure === 'folder') return { path, children: [] };
            if (failure === 'image') return { path };
            return { path }; // A different object on every live lookup is not an identity.
        });
        expect(run.resolveNoteId(path)).toBeUndefined();
        expect(contextNotes(run).notes).toEqual([{ handle: 'note_1', path: h.a.path }]);
    });

    it.each(['delete', 'replace', 'rename'] as const)('does not rebind or revive a captured note after %s', change => {
        const h = fixture();
        const run = h.create();
        const originalPath = h.a.path;
        const scope = commit(run);
        h.files.delete(originalPath);
        if (change === 'replace') h.files.set(originalPath, { path: originalPath });
        if (change === 'rename') {
            h.a.path = 'notes/renamed.md';
            h.files.set(h.a.path, h.a);
            expect(run.resolveNoteId(h.a.path)).toBeUndefined();
        }
        expect(run.resolveNoteId(originalPath)).toBeUndefined();
        expect(() => run.resolveNoteSearchScope(scope)).toThrow('identity is no longer live');
        expect(contextNotes(run)).toEqual({ currentNoteHandle: null, notes: [] });
        h.a.path = originalPath;
        h.files.set(originalPath, h.a);
        expect(run.resolveNoteId(originalPath)).toBeUndefined();
    });

    it('accepts a new pane of the same current note but refuses to read a newly selected current note', () => {
        const h = fixture();
        const run = h.create();
        const calls = [call('current', 'get_current_note_context')];
        h.setActive({ file: h.a });
        expect(run.resolveReadPlans(calls)?.get('current')).toEqual({ reads: [{ kind: 'note', noteId: 'run-1:note:1' }] });
        h.setActive({ file: h.b });
        expect(run.resolveReadPlans(calls)).toBeUndefined();
        expect(contextNotes(run).currentNoteHandle).toBeNull();
        expect(run.resolveReadPlans([call('exact', 'read_note_outline', { path: h.a.path })])).toBeDefined();
    });

    it('does not adopt a later current view when construction had no current Markdown note', () => {
        const h = fixture();
        h.setActive(null);
        const run = h.create();
        h.setActive({ file: h.a });
        expect(run.resolveNoteId(h.a.path)).toBeDefined();
        expect(contextNotes(run).currentNoteHandle).toBeNull();
        expect(run.resolveReadPlans([call('current', 'get_current_note_context')])).toBeUndefined();
        expect(run.state.prepareDeclaration({ instructionQuote: '只用当前笔记', notes: 'current_note', webAllowed: false }))
            .toEqual({ ok: false, reason: 'unknown_note_handle' });
    });

    it('requires its own current committed constraint and distinguishes no notes from the vault', () => {
        const h = fixture();
        const run = h.create();
        const candidate = prepare(run, { notes: 'vault' });
        expect(() => run.resolveNoteSearchScope(candidate)).toThrow();
        expect(run.state.commit(candidate)).toBe(true);
        expect(run.resolveNoteSearchScope(candidate)).toEqual({ allowedPaths: null, excludedPaths: [] });
        expect(() => run.resolveNoteSearchScope({ ...candidate })).toThrow();
        expect(() => run.resolveNoteSearchScope(commit(h.create(), { notes: 'vault' }))).toThrow();
        const current = commit(run);
        expect(run.resolveNoteSearchScope(current)).toEqual({ allowedPaths: [h.a.path], excludedPaths: [] });
        const empty = commit(run, { notes: 'none' });
        expect(() => run.resolveNoteSearchScope(current)).toThrow();
        const scope = run.resolveNoteSearchScope(empty);
        expect(scope).toEqual({ allowedPaths: [], excludedPaths: [] });
        expect(Object.isFrozen(scope)).toBe(true);
        expect(Object.isFrozen(scope.allowedPaths)).toBe(true);
        expect(Object.isFrozen(scope.excludedPaths)).toBe(true);
    });

    it('rejects the entire search when any selected allowed identity has gone away', () => {
        const h = fixture();
        const run = h.create();
        const vaultScope = commit(run, { notes: 'vault' });
        expect(run.publishAdmittedNotePaths([h.b.path], vaultScope)).toBe(true);
        const scope = commit(run, { notes: 'selected', noteHandles: contextNotes(run).notes.map(note => note.handle) });
        expect(run.resolveNoteSearchScope(scope)).toEqual({ allowedPaths: [h.a.path, h.b.path], excludedPaths: [] });
        h.files.delete(h.b.path);
        expect(() => run.resolveNoteSearchScope(scope)).toThrow('identity is no longer live');
    });

    it('retains the original excluded path after deletion and same-path recreation', () => {
        const h = fixture();
        const run = h.create();
        const vaultScope = commit(run, { notes: 'vault' });
        expect(run.publishAdmittedNotePaths([h.b.path], vaultScope)).toBe(true);
        const handle = contextNotes(run).notes.find(note => note.path === h.b.path)!.handle;
        const constraint = commit(run, { notes: 'vault', excludedNoteHandles: [handle] });
        expect(contextNotes(run).notes.map(note => note.path)).toEqual([h.a.path]);
        h.files.delete(h.b.path);
        expect(run.resolveNoteSearchScope(constraint)).toEqual({ allowedPaths: null, excludedPaths: [h.b.path] });
        h.files.set(h.b.path, { path: h.b.path });
        expect(run.resolveNoteId(h.b.path)).toBeUndefined();
        expect(run.resolveNoteSearchScope(constraint)).toEqual({ allowedPaths: null, excludedPaths: [h.b.path] });
    });

    it.each(['allowed', 'excluded'] as const)('rejects a state-only %s handle that has no real run identity', kind => {
        const run = fixture().create();
        expect(run.state.registerNoteHandle('foreign', 'unbound-note')).toBe(true);
        const scope = commit(run, kind === 'allowed'
            ? { notes: 'selected', noteHandles: ['foreign'] }
            : { notes: 'vault', excludedNoteHandles: ['foreign'] });
        expect(() => run.resolveNoteSearchScope(scope)).toThrow();
    });

    it('rejects a revoked run before identity reads and handles a failing lifecycle check', () => {
        const h = fixture();
        const run = h.create();
        const scope = commit(run);
        h.getFileByPath.mockClear();
        h.setCurrent(false);
        expect(run.isCurrent()).toBe(false);
        expect(run.resolveNoteId(h.b.path)).toBeUndefined();
        expect(run.resolveReadPlans([])).toBeUndefined();
        expect(() => run.resolveNoteSearchScope(scope)).toThrow();
        expect(() => run.contextInstruction()).toThrow();
        expect(h.getFileByPath).not.toHaveBeenCalled();
        h.host.isCurrent = () => { throw new Error('no host'); };
        expect(h.create().isCurrent()).toBe(false);
    });

    it.each(['run', 'scope'] as const)('rechecks %s currentness after live identity lookup', change => {
        const h = fixture();
        const run = h.create();
        const scope = commit(run);
        h.getFileByPath.mockImplementation(path => {
            if (change === 'run') h.setCurrent(false);
            else commit(run, { notes: 'none' });
            return h.files.get(path);
        });
        expect(() => run.resolveNoteSearchScope(scope)).toThrow('scope is no longer current');
    });

    it('plans a complete core batch with real discovered identities and preserves virtual Operations order', () => {
        const h = fixture();
        const run = h.create();
        const calls = [call('current', 'get_current_note_context'), call('outline', 'read_note_outline', { notePath: h.b.path }),
            call('canvas', 'read_canvas_summary', { canvasPath: h.canvas.path }), call('memory', 'search_memory', 'a query'),
            call('metadata', 'search_vault_metadata'), call('web', 'webSearch'),
            call('create', 'vault_create', { path: 'notes/new.md', content: 'draft' }),
            call('append', 'vault_append', { path: 'notes/new.md', content: 'more' })];
        const plans = run.resolveReadPlans(calls)!;
        expect(plans.size).toBe(calls.length);
        expect(plans.get('outline')).toEqual({ reads: [{ kind: 'note', noteId: run.resolveNoteId(h.b.path) }] });
        expect(plans.get('canvas')).toEqual({ reads: [{ kind: 'note', noteId: run.resolveNoteId(h.canvas.path) }] });
        expect(plans.get('memory')).toEqual({ reads: [{ kind: 'scoped_vault_search' }] });
        expect(plans.get('metadata')).toEqual(plans.get('memory'));
        expect(plans.get('web')).toEqual({ reads: [{ kind: 'web' }] });
        expect(plans.get('append')).toEqual({ reads: [], outputTargetPaths: ['notes/new.md'] });
        expect(h.getFileByPath).not.toHaveBeenCalledWith('notes/new.md');
        expect(run.resolveReadPlans([calls[calls.length - 1], calls[calls.length - 2]])).toBeUndefined();
        expect(run.state.snapshot()).toBeUndefined();
    });

    it.each(['unknown_tool', 'load_tool_capability', 'read_image', 'present_writing'])
    ('rejects the complete batch for unplanned %s instead of assigning no reads', name => {
        const run = fixture().create();
        expect(run.resolveReadPlans([call('current', 'get_current_note_context'), call('extra', name)])).toBeUndefined();
        expect(run.state.snapshot()).toBeUndefined();
    });

    it('admits a declaration plus current-note and Memory reads together with a live scoped guard', () => {
        const h = fixture();
        const run = h.create();
        const executor = executorFor(run);
        const result = executor.preflight([
            call('scope', DECLARE_SOURCE_SCOPE, { instructionQuote: '只用当前笔记', notes: 'current_note', webAllowed: false }),
            call('current', 'get_current_note_context'), call('memory', 'search_memory', 'query'),
        ]);
        if (!result || !('kind' in result)) throw new Error('Expected source admission');
        expect(result.controlResults?.get('scope')?.outcome).toBe('control_applied');
        const guard = result.taskSourceReadGuard;
        if (!guard) throw new Error('Expected the admitted source guard');
        expect(guard.getNoteSearchScope!()).toEqual({ allowedPaths: [h.a.path], excludedPaths: [] });
        expect(guard.isPathAllowed(h.a.path)).toBe(true);
        expect(guard.isPathAllowed(h.b.path)).toBe(false);
        expect(contextNotes(run).notes.map(note => note.path)).toEqual([h.a.path]);
        expect(run.state.snapshot()?.allowedNoteIds).toEqual(['run-1:note:1']);
        h.files.set(h.a.path, { path: h.a.path });
        expect(guard.isPathAllowed(h.a.path)).toBe(false);
        expect(() => guard.getNoteSearchScope!()).toThrow();
        expect(executor.execute).not.toHaveBeenCalled();
        expect(executor.prepareBatch).not.toHaveBeenCalled();
    });

    it('rejects a mixed out-of-scope batch without committing even though its identities were discovered', () => {
        const h = fixture();
        const run = h.create();
        const executor = executorFor(run);
        expect(executor.preflight([
            call('scope', DECLARE_SOURCE_SCOPE, { instructionQuote: '只用当前笔记', notes: 'current_note', webAllowed: false }),
            call('current', 'get_current_note_context'), call('other', 'read_note_outline', { path: h.b.path }),
        ])).toMatchObject({ outcome: 'policy_rejected', metadata: { reason: 'source_read_outside_scope' } });
        expect(run.resolveNoteId(h.b.path)).toBeDefined();
        expect(contextNotes(run).notes.some(note => note.path === h.b.path)).toBe(false);
        expect(run.state.snapshot()).toBeUndefined();
        expect(executor.execute).not.toHaveBeenCalled();
        expect(executor.prepareBatch).not.toHaveBeenCalled();
    });

    it('keeps current-note scope and its next instruction unchanged after guard probes and rejected reads of other notes', () => {
        const h = fixture();
        const run = h.create();
        const scope = commit(run);
        const before = run.contextInstruction();
        const guard = run.state.createReadGuard(scope, run.resolveNoteId, run.isCurrent);
        expect(guard.isPathAllowed(h.b.path)).toBe(false);
        expect(guard.isPathAllowed(h.canvas.path)).toBe(false);
        const executor = executorFor(run);
        expect(executor.preflight([call('other', 'inspect_obsidian_note', { path: h.b.path })]))
            .toMatchObject({ outcome: 'policy_rejected', metadata: { reason: 'source_read_outside_scope' } });
        expect(run.publishAdmittedNotePaths([h.b.path], scope)).toBe(false);
        expect(run.contextInstruction()).toBe(before);
        expect(run.contextInstruction()).not.toContain(h.b.path);
        expect(run.contextInstruction()).not.toContain(h.canvas.path);
        expect(run.state.snapshot()).toBe(scope);
        expect(executor.execute).not.toHaveBeenCalled();
        expect(executor.prepareBatch).not.toHaveBeenCalled();
    });

    it('does not publish a successful plan or a rejected plan before any scope is committed', () => {
        const h = fixture();
        const run = h.create();
        const before = run.contextInstruction();
        expect(run.resolveReadPlans([call('other', 'inspect_obsidian_note', { path: h.b.path })])).toBeDefined();
        expect(run.resolveReadPlans([call('canvas', 'read_canvas_summary', { path: h.canvas.path }),
            call('unknown', 'unplanned_tool')])).toBeUndefined();
        expect(run.resolveNoteId(h.b.path)).toBeDefined();
        expect(run.resolveNoteId(h.canvas.path)).toBeDefined();
        const candidate = prepare(run, { notes: 'vault' });
        expect(run.publishAdmittedNotePaths([h.b.path], candidate)).toBe(false);
        expect(run.contextInstruction()).toBe(before);
        expect(run.state.snapshot()).toBeUndefined();
    });

    it('does not turn thousands of internal vault guard registrations into a public directory', () => {
        const h = fixture();
        const run = h.create();
        const scope = commit(run, { notes: 'vault' });
        const guard = run.state.createReadGuard(scope, run.resolveNoteId, run.isCurrent);
        const before = run.contextInstruction();
        let allowedCount = 0;
        for (let index = 0; index < 3000; index++) {
            const file = { path: `private/folder/note-${index}.md` };
            h.files.set(file.path, file);
            if (guard.isPathAllowed(file.path)) allowedCount++;
        }
        expect(allowedCount).toBe(3000);
        expect(run.contextInstruction()).toBe(before);
        expect(contextNotes(run).notes).toHaveLength(1);
        expect(run.state.snapshot()).toBe(scope);
    });

    it('publishes host-confirmed visible sources only within the exact current scope and hides later exclusions', () => {
        const h = fixture();
        const run = h.create();
        const scope = commit(run, { notes: 'vault' });
        run.resolveReadPlans([call('other', 'read_note_outline', { path: h.b.path })]);
        expect(contextNotes(run).notes.map(note => note.path)).toEqual([h.a.path]);
        expect(run.publishAdmittedNotePaths([h.b.path], { ...scope })).toBe(false);
        expect(run.publishAdmittedNotePaths([h.b.path, h.canvas.path], scope)).toBe(true);
        const data = contextNotes(run);
        expect(data.notes.map(note => note.path)).toEqual([h.a.path, h.canvas.path, h.b.path]);
        const excluded = data.notes.find(note => note.path === h.b.path)!.handle;
        const narrower = commit(run, { notes: 'vault', excludedNoteHandles: [excluded] });
        expect(run.publishAdmittedNotePaths([h.b.path], narrower)).toBe(false);
        expect(run.publishAdmittedNotePaths([h.canvas.path], scope)).toBe(false);
        expect(contextNotes(run).notes.map(note => note.path)).toEqual([h.a.path, h.canvas.path]);
        const none = commit(run, { notes: 'none' });
        expect(contextNotes(run)).toEqual({ currentNoteHandle: null, notes: [] });
        expect(run.publishAdmittedNotePaths([h.a.path], none)).toBe(false);
    });

    it('keeps the current note and recent visible sources within the handle limit without deleting old bindings', () => {
        const h = fixture();
        const run = h.create();
        const scope = commit(run, { notes: 'vault' });
        const paths = Array.from({ length: MAX_TASK_SOURCE_NOTE_HANDLES + 20 }, (_, index) => `notes/visible-${index}.md`);
        for (const path of paths) h.files.set(path, { path });
        const firstId = run.resolveNoteId(paths[0]);
        expect(run.publishAdmittedNotePaths(paths, scope)).toBe(true);
        let visiblePaths = contextNotes(run).notes.map(note => note.path);
        expect(visiblePaths).toEqual([h.a.path, ...paths.slice(-(MAX_TASK_SOURCE_NOTE_HANDLES - 1)).reverse()]);
        expect(run.resolveNoteId(paths[0])).toBe(firstId);
        expect(contextNotes(run).notes.map(note => note.path)).toEqual(visiblePaths);
        expect(run.publishAdmittedNotePaths([paths[0]], scope)).toBe(true);
        visiblePaths = contextNotes(run).notes.map(note => note.path);
        expect(visiblePaths).toHaveLength(MAX_TASK_SOURCE_NOTE_HANDLES);
        expect(visiblePaths.slice(0, 2)).toEqual([h.a.path, paths[0]]);
        expect(run.state.snapshot()).toBe(scope);
    });

    it('budgets escaped directory characters using whole paths, while keeping the newest visible sources', () => {
        const h = fixture();
        const run = h.create();
        const scope = commit(run, { notes: 'vault' });
        const paths = Object.freeze(Array.from({ length: 8 }, (_, index) => `notes/${'<&'.repeat(250)}-${index}.md`));
        for (const path of paths) h.files.set(path, { path });
        expect(run.publishAdmittedNotePaths(paths, scope)).toBe(true);
        const encoded = run.contextInstruction().split('\n').slice(-1)[0];
        const data = contextNotes(run);
        expect(encoded.length).toBeLessThanOrEqual(MAX_TASK_SOURCE_NOTE_DIRECTORY_CHARS);
        expect(data.notes.length).toBeLessThan(paths.length);
        expect(data.notes[0].path).toBe(h.a.path);
        expect(data.notes[1].path).toBe(paths[paths.length - 1]);
        expect(data.notes.every(note => note.path === h.a.path || paths.includes(note.path))).toBe(true);
    });

    it('retains an opaque current handle without truncating a current path that exceeds the directory budget', () => {
        const h = fixture(`notes/${'<&'.repeat(1000)}.md`);
        const run = h.create();
        const scope = commit(run, { notes: 'vault' });
        expect(run.publishAdmittedNotePaths([h.b.path], scope)).toBe(true);
        const encoded = run.contextInstruction().split('\n').slice(-1)[0];
        expect(encoded.length).toBeLessThanOrEqual(MAX_TASK_SOURCE_NOTE_DIRECTORY_CHARS);
        expect(contextNotes(run)).toEqual({ currentNoteHandle: 'note_1', notes: [{ handle: 'note_2', path: h.b.path }] });
        expect(run.resolveNoteId(h.a.path)).toBe('run-1:note:1');
    });

    it('does not partially publish a group when a later source identity cannot be verified', () => {
        const h = fixture();
        const run = h.create();
        const scope = commit(run, { notes: 'vault' });
        const before = run.contextInstruction();
        expect(run.publishAdmittedNotePaths([h.b.path, 'notes/missing.md'], scope)).toBe(false);
        expect(run.contextInstruction()).toBe(before);
        expect(run.resolveNoteId(h.b.path)).toBeDefined();
    });

    it('emits only live host handles with escaped paths and separates background from task permissions', () => {
        const h = fixture('notes/</host>"&\n\u2028\u2029.md');
        const run = h.create();
        const instruction = run.contextInstruction();
        expect(instruction).not.toContain('</host>');
        expect(instruction).toContain('\\u003c/host\\u003e');
        expect(contextNotes(run).notes).toEqual([{ handle: 'note_1', path: h.a.path }]);
        expect(instruction).toContain('same tool-call batch');
        expect(instruction).toContain('Personal, existing Memory background');
        expect(instruction).toContain('authorized style or history');
        expect(instruction).toContain('neither write nor network permission');
        expect(instruction).toContain('Data Boundary, Forget, or action confirmation');
        expect(instruction).not.toContain(h.host.userText);
    });
});
