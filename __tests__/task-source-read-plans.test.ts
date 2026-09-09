import type { Workspace } from 'obsidian';
import {
    createInspectObsidianNoteTool,
    createReadCanvasSummaryTool,
    createReadNoteOutlineTool,
} from '../src/ai-services/chat-tool-factories';
import { OperationsIntentController } from '../src/ai-services/operations/operations-intent-controller';
import type { CoreWriteToolName, OperationsVault } from '../src/ai-services/operations/types';
import type { ParsedBufferedToolCall } from '../src/ai-services/pa-agent-types';
import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';
import { createTaskSourceConstrainedExecutor, DECLARE_SOURCE_SCOPE } from '../src/ai-services/task-source-executor';
import { TaskSourceNoteIdentities } from '../src/ai-services/task-source-note-identities';
import { resolveTaskSourceReadPlans, type TaskSourceReadPlanHost } from '../src/ai-services/task-source-read-plans';

jest.mock('obsidian');

function call(id: string, name: string, input: unknown = {}): ParsedBufferedToolCall {
    return { type: 'toolCall', id, name, input, index: 0 };
}

function fixture() {
    const ids = new Map([['notes/a.md', 'note-a'], ['notes/b.md', 'note-b'], ['notes/board.canvas', 'canvas-board']]);
    const host: TaskSourceReadPlanHost = {
        resolveNoteId: jest.fn(path => ids.get(path)),
        currentNoteId: jest.fn(() => 'note-a'),
        actualCurrentNotePath: jest.fn(() => 'notes/a.md'),
    };
    return { host, ids };
}

function plansFor(calls: ParsedBufferedToolCall[], host: TaskSourceReadPlanHost) {
    const result = resolveTaskSourceReadPlans(calls, host);
    if (!result.ok) throw new Error(`${result.toolCallId}: ${result.reason}`);
    return result.plans;
}

function currentState() {
    const state = new TaskSourceConstraintState({ runId: 'run', userMessageId: 'user',
        userText: '只用当前笔记', currentNoteHandle: 'current', noteHandles: new Map([['current', 'note-a'], ['other', 'note-b']]) });
    const candidate = state.prepareDeclaration({ instructionQuote: '只用当前笔记', notes: 'current_note', webAllowed: false });
    if (!candidate.ok) throw new Error(candidate.reason);
    return { state, candidate: candidate.constraint };
}

describe('Task source raw batch read plans', () => {
    it('plans all eight existing Vault tools plus Memory and web without reading host data', () => {
        const { host } = fixture();
        const forbidden = jest.fn(() => { throw new Error('No body, metadata or registry preparation'); });
        for (const key of ['app', 'metadataCache', 'registry', 'read', 'cachedRead']) {
            Object.defineProperty(host, key, { get: forbidden });
        }
        const calls = [
            call('current', 'get_current_note_context', { mode: 'metadata', path: 'notes/b.md' }),
            call('outline', 'read_note_outline', { notePath: 'notes/a.md' }),
            call('inspect', 'inspect_obsidian_note', {}),
            call('canvas', 'read_canvas_summary', { canvasPath: 'notes/board.canvas' }),
            call('metadata', 'search_vault_metadata', { path: 'notes/b.md' }),
            call('recent', 'list_recent_notes'),
            call('snippets', 'search_vault_snippets', { q: 'exact token', folder: 'notes' }),
            call('tags', 'list_vault_tags'),
            call('memory', 'search_memory', 'What is in notes/b.md?'),
            call('web', 'webSearch', { q: 'query' }),
        ];
        const before = JSON.stringify(calls);
        for (const entry of calls) {
            if (entry.input && typeof entry.input === 'object') Object.freeze(entry.input);
            Object.freeze(entry);
        }
        const plans = plansFor(calls, host);
        for (const id of ['current', 'outline', 'inspect']) {
            expect(plans.get(id)).toEqual({ reads: [{ kind: 'note', noteId: 'note-a' }] });
        }
        expect(plans.get('canvas')).toEqual({ reads: [{ kind: 'note', noteId: 'canvas-board' }] });
        for (const id of ['metadata', 'recent', 'snippets', 'tags', 'memory']) {
            expect(plans.get(id)).toEqual({ reads: [{ kind: 'scoped_vault_search' }] });
        }
        expect(plans.get('web')).toEqual({ reads: [{ kind: 'web' }] });
        expect(host.resolveNoteId).not.toHaveBeenCalledWith('notes/b.md');
        expect(forbidden).not.toHaveBeenCalled();
        expect(JSON.stringify(calls)).toBe(before);
        expect(Object.isFrozen(plans.get('outline')!.reads[0])).toBe(true);
    });

    it.each([
        ['read_note_outline', createReadNoteOutlineTool, 'notes/a.md', 'note-a'],
        ['inspect_obsidian_note', createInspectObsidianNoteTool, 'notes/a.md', 'note-a'],
        ['read_canvas_summary', createReadCanvasSummaryTool, 'notes/board.canvas', 'canvas-board'],
    ] as const)('matches %s actual argument preparation for aliases and nested inputs', (name, makeTool, path, noteId) => {
        const { host } = fixture();
        const tool = makeTool();
        const rawInputs = [path, { path }, { notePath: path }, { file_path: path }, { canvas: path },
            { input: { target: path } }, { path: ' ', note_path: path }, { path, file: 'notes/b.md' }];
        for (const raw of rawInputs) {
            const prepared = tool.prepareArguments!(raw, { userInput: '' });
            expect(tool.validateInput(prepared).path).toBe(path);
            expect(plansFor([call('read', name, raw)], host).get('read'))
                .toEqual({ reads: [{ kind: 'note', noteId }] });
        }
    });

    it.each(['notes\\a.md', ' notes//a.md ', './notes/a.md', './/notes/a.md', 'notes/a.md/'])(
        'matches the outline reader boundary path normalization for %s', rawPath => {
            const { host } = fixture();
            const plan = plansFor([call('outline', 'read_note_outline', { path: rawPath })], host).get('outline');
            expect(plan).toEqual({ reads: [{ kind: 'note', noteId: 'note-a' }] });
            expect(host.resolveNoteId).toHaveBeenCalledWith('notes/a.md');
        },
    );

    it.each([{}, null, [], 'not-a-note-path', { path: ' ' }, { notePath: 'notes/board.canvas' }])(
        'preserves the actual inspect current-note fallback for %j', raw => {
            const { host } = fixture();
            const tool = createInspectObsidianNoteTool();
            expect(tool.validateInput(tool.prepareArguments!(raw, { userInput: '' }))).toEqual({});
            expect(plansFor([call('inspect', 'inspect_obsidian_note', raw)], host).get('inspect'))
                .toEqual({ reads: [{ kind: 'note', noteId: 'note-a' }] });
        },
    );

    it.each(['read_note_outline', 'inspect_obsidian_note', 'read_canvas_summary'])(
        'rejects %s unresolved explicit paths instead of substituting the current note', name => {
            const { host } = fixture();
            const path = name === 'read_canvas_summary' ? 'missing.canvas' : 'missing.md';
            expect(resolveTaskSourceReadPlans([call('read', name, { path })], host))
                .toEqual({ ok: false, toolCallId: 'read', reason: 'source_identity_unavailable' });
            expect(host.currentNoteId).not.toHaveBeenCalled();
        },
    );

    it.each(['/notes/a.md', '../notes/a.md', 'C:\\notes\\a.md', 'notes/../a.md'])(
        'rejects invalid source paths before identity lookup: %s', path => {
            const { host } = fixture();
            expect(resolveTaskSourceReadPlans([call('read', 'read_note_outline', { path })], host))
                .toEqual({ ok: false, toolCallId: 'read', reason: 'invalid_call' });
            expect(host.resolveNoteId).not.toHaveBeenCalled();
        },
    );

    it('compares the captured current identity with the actual current path and live identity', () => {
        const { host, ids } = fixture();
        host.actualCurrentNotePath = () => 'notes/b.md';
        expect(resolveTaskSourceReadPlans([call('current', 'get_current_note_context')], host))
            .toEqual({ ok: false, toolCallId: 'current', reason: 'source_identity_unavailable' });
        host.actualCurrentNotePath = () => 'notes/a.md';
        ids.set('notes/a.md', 'replacement-a');
        expect(resolveTaskSourceReadPlans([call('current', 'inspect_obsidian_note')], host))
            .toEqual({ ok: false, toolCallId: 'current', reason: 'source_identity_unavailable' });
    });

    it('rejects a real same-path file replacement when wired to the run identity module', () => {
        const file = { path: 'notes/a.md' };
        let currentFile = file;
        const workspace = { getActiveViewOfType: () => ({ file: currentFile }) } as unknown as Workspace;
        const identities = new TaskSourceNoteIdentities({ runId: 'run', workspace, getFileByPath: () => currentFile });
        const host = { resolveNoteId: (path: string) => identities.resolveNoteId(path),
            currentNoteId: () => identities.currentNote?.noteId, actualCurrentNotePath: () => currentFile.path };
        expect(resolveTaskSourceReadPlans([call('current', 'get_current_note_context')], host).ok).toBe(true);
        currentFile = { path: file.path };
        expect(resolveTaskSourceReadPlans([call('current', 'get_current_note_context')], host))
            .toEqual({ ok: false, toolCallId: 'current', reason: 'source_identity_unavailable' });
    });

    it('requires a declared restricted scope for enumeration, while an exact snippet path requires that note', () => {
        const { host } = fixture();
        const { state, candidate } = currentState();
        const plans = plansFor([
            call('metadata', 'search_vault_metadata', { filename: 'notes/b.md' }),
            call('tags', 'list_vault_tags'),
            call('folder', 'search_vault_snippets', { input: { q: 'token', folder: 'notes//' } }),
            call('exact', 'search_vault_snippets', { q: 'token', path: 'notes/b.md' }),
        ], host);
        for (const id of ['metadata', 'tags', 'folder']) {
            expect(plans.get(id)!.reads.every(read => state.allows(read))).toBe(false);
            expect(plans.get(id)!.reads.every(read => state.allows(read, candidate))).toBe(true);
        }
        expect(plans.get('exact')!.reads.every(read => state.allows(read, candidate))).toBe(false);
        expect(plans.get('exact')).toEqual({ reads: [{ kind: 'note', noteId: 'note-b' }] });
    });

    it.each(['resolve_chat_images', 'load_skill', 'get_writing_style', 'present_writing', 'declare_source_scope', 'unknown_plugin_tool'])(
        'leaves %s unplanned instead of trusting model purpose or capability labels', name => {
            const { host } = fixture();
            expect(resolveTaskSourceReadPlans([call('pending', name, { kind: 'meta', reads: [], sourceBoundary: 'none' })], host))
                .toEqual({ ok: false, toolCallId: 'pending', reason: 'unplanned_tool' });
            expect(host.resolveNoteId).not.toHaveBeenCalled();
        },
    );

    it.each(['duplicate', 'parse_error'] as const)('rejects the entire %s batch before host resolution', failure => {
        const { host } = fixture();
        const second = call(failure === 'duplicate' ? 'first' : 'second', 'read_note_outline', { path: 'notes/a.md' });
        if (failure === 'parse_error') second.parseError = 'incomplete JSON';
        const result = resolveTaskSourceReadPlans([call('first', 'get_current_note_context'), second], host);
        expect(result).toMatchObject({ ok: false, reason: 'invalid_call' });
        expect(result).not.toHaveProperty('plans');
        expect(host.currentNoteId).not.toHaveBeenCalled();
    });
});

describe('Operations task source virtual baseline plans', () => {
    function wrappedPlanner() {
        const { host } = fixture();
        const { state } = currentState();
        const execute = jest.fn();
        const prepareBatch = jest.fn();
        const resolveReadPlans = jest.fn((calls: readonly ParsedBufferedToolCall[]) => {
            const result = resolveTaskSourceReadPlans(calls, host);
            return result.ok ? result.plans : undefined;
        });
        const executor = createTaskSourceConstrainedExecutor({ state, baseExecutor: { execute, prepareBatch },
            resolveReadPlans, resolveHostNoteId: host.resolveNoteId, isHostCurrent: () => true });
        const preflight = (toolCalls: ParsedBufferedToolCall[]) => executor.preflightBatch!({
            runId: 'run', turnId: 'turn', turnIndex: 0, userInput: '只用当前笔记', toolCalls,
        });
        return { state, execute, prepareBatch, resolveReadPlans, preflight };
    }

    it('admits create-then-append through the batch resolver with a notes:none declaration', () => {
        const h = wrappedPlanner();
        const create = call('create', 'vault_create', { path: 'notes/new.md', content: 'draft' });
        const append = call('append', 'vault_append', { path: 'notes/new.md', content: 'addition' });
        const result = h.preflight([
            call('scope', DECLARE_SOURCE_SCOPE, { instructionQuote: '只用当前笔记', notes: 'none', webAllowed: false }),
            create, append,
        ]);
        expect(h.resolveReadPlans).toHaveBeenCalledTimes(1);
        expect(h.resolveReadPlans).toHaveBeenCalledWith([create, append]);
        if (!result || !('kind' in result)) throw new Error('Expected batch admission');
        expect(h.state.snapshot()?.allowedNoteIds).toEqual([]);
        expect(result.taskSourceReadGuard!.isPathAllowed('notes/new.md', 'output_target_exists')).toBe(true);
        expect(result.taskSourceReadGuard!.isPathAllowed('notes/new.md', 'task_material')).toBe(false);
        expect(result.controlResults?.get('scope')?.outcome).toBe('control_applied');
        expect(h.execute).not.toHaveBeenCalled();
        expect(h.prepareBatch).not.toHaveBeenCalled();
    });

    it.each([false, true])('rejects append-then-create before preparation with a current-note declaration: %s', declare => {
        const h = wrappedPlanner();
        const calls = [call('append', 'vault_append', { path: 'notes/b.md', content: 'addition' }),
            call('create', 'vault_create', { path: 'notes/b.md', content: 'draft' })];
        if (declare) calls.unshift(call('scope', DECLARE_SOURCE_SCOPE,
            { instructionQuote: '只用当前笔记', notes: 'current_note', webAllowed: false }));
        expect(h.preflight(calls)).toMatchObject({ outcome: 'policy_rejected', metadata: {
            reason: declare ? 'source_read_outside_scope' : 'source_declaration_required',
        } });
        expect(h.state.snapshot()).toBeUndefined();
        expect(h.execute).not.toHaveBeenCalled();
        expect(h.prepareBatch).not.toHaveBeenCalled();
    });

    it.each([
        ['vault_append', { content: 'addition' }],
        ['vault_process', { operation: 'replace', params: { search: 'before', replace: 'after' } }],
        ['frontmatter_update', { set: { status: 'draft' } }],
    ])('requires the original note for %s unless this same batch creates it first', (name, extra) => {
        const { host } = fixture();
        const input = { path: 'notes/b.md', ...(extra as object) };
        expect(plansFor([call('change', name as string, input)], host).get('change'))
            .toEqual({ reads: [{ kind: 'note', noteId: 'note-b' }] });
        const plans = plansFor([call('create', 'vault_create', { path: 'notes/new.md', content: 'before' }),
            call('change', name as string, { ...input, path: 'notes/new.md' })], host);
        expect(plans.get('change')).toEqual({ reads: [], outputTargetPaths: ['notes/new.md'] });
        expect(host.resolveNoteId).not.toHaveBeenCalledWith('notes/new.md');
    });

    it('retains the first baseline per canonical path across interleaved targets', () => {
        const { host } = fixture();
        const plans = plansFor([
            call('create-new', 'vault_create', { path: './notes//new.md', content: 'draft' }),
            call('append-old', 'vault_append', { path: 'notes/b.md', content: 'addition' }),
            call('append-new', 'vault_append', { path: 'notes\\new.md', content: 'addition' }),
            call('create-old', 'vault_create', { path: 'notes/b.md', content: 'conflict' }),
        ], host);
        for (const id of ['create-new', 'append-new']) expect(plans.get(id))
            .toEqual({ reads: [], outputTargetPaths: ['notes/new.md'] });
        for (const id of ['append-old', 'create-old']) expect(plans.get(id))
            .toEqual({ reads: [{ kind: 'note', noteId: 'note-b' }] });
    });

    it('does not carry virtual targets into another batch or a separate source tool', () => {
        const { host } = fixture();
        expect(resolveTaskSourceReadPlans([call('create', 'vault_create', { path: 'notes/new.md', content: 'draft' })], host).ok).toBe(true);
        expect(resolveTaskSourceReadPlans([call('append', 'vault_append', { path: 'notes/new.md', content: 'addition' })], host))
            .toEqual({ ok: false, toolCallId: 'append', reason: 'source_identity_unavailable' });
        expect(resolveTaskSourceReadPlans([
            call('create', 'vault_create', { path: 'notes/new.md', content: 'draft' }),
            call('inspect', 'inspect_obsidian_note', { path: 'notes/new.md' }),
        ], host)).toEqual({ ok: false, toolCallId: 'inspect', reason: 'source_identity_unavailable' });
    });

    it.each([
        { file: 'notes/new.md', content: 'draft' },
        { path: '../new.md', content: 'draft' },
        { path: '.obsidian/new.md', content: 'draft' },
        { path: 'notes/new.md', content: 'draft', taskSourceReadGuard: { isCurrent: true } },
    ])('uses the real Operations schema and path rules before admitting a virtual target: %j', input => {
        const { host } = fixture();
        expect(resolveTaskSourceReadPlans([call('create', 'vault_create', input)], host))
            .toEqual({ ok: false, toolCallId: 'create', reason: 'invalid_call' });
        expect(host.resolveNoteId).not.toHaveBeenCalled();
    });

    it('feeds the real controller a create-then-append plan without reading an old body', async () => {
        const { host } = fixture();
        const calls = [call('create', 'vault_create', { path: 'notes/new.md', content: 'draft' }),
            call('append', 'vault_append', { path: 'notes/new.md', content: 'addition' })];
        const plans = plansFor(calls, host);
        const { state, candidate } = currentState();
        expect([...plans.values()].every(plan => plan.reads.every(read => state.allows(read, candidate)))).toBe(true);
        expect(state.commit(candidate)).toBe(true);
        const targets = new Set([...plans.values()].flatMap(plan => [...plan.outputTargetPaths ?? []]));
        const guard = state.createReadGuard(candidate, host.resolveNoteId, () => true, path => targets.has(path));
        const vault: OperationsVault = {
            getAbstractFileByPath: jest.fn(path => path === 'notes' ? { path, children: [] } : null),
            adapter: { exists: jest.fn(async path => path === 'notes') },
            cachedRead: jest.fn(async () => { throw new Error('No old-body permission'); }),
            create: jest.fn(async path => ({ path })),
            process: jest.fn(async () => undefined),
        };
        const controller = new OperationsIntentController({ vault, trashFile: async () => undefined });
        try {
            const intent = await controller.stageIntent({ runId: 'run', turnId: 'turn', taskSourceReadGuard: guard,
                operations: calls.map(entry => ({ toolCallId: entry.id, name: entry.name as CoreWriteToolName, input: entry.input })) });
            expect(intent.operations[1].expectedBefore).toBe('draft');
            expect(vault.adapter.exists).toHaveBeenCalledWith('notes/new.md');
            expect(vault.cachedRead).not.toHaveBeenCalled();
            expect(vault.create).not.toHaveBeenCalled();
            expect(guard.isPathAllowed('notes/new.md', 'task_material')).toBe(false);
            expect(guard.isPathAllowed('notes/new.md', 'output_target_exists')).toBe(true);
        } finally { controller.dispose(); }
    });
});
