import { TaskSourceConstraintState, type TaskSourceConstraint } from '../src/ai-services/task-source-constraint';

const text = '请只用当前笔记。保留个性化背景。';
function harness() {
    const handles = new Map([['active', 'note-a'], ['other', 'note-b']]);
    const state = new TaskSourceConstraintState({ runId: 'run', userMessageId: 'user-1', userText: text,
        noteHandles: handles, currentNoteHandle: 'active' });
    return { state, handles };
}
function declaration(notes = 'current_note', extra: Record<string, unknown> = {}) {
    return { instructionQuote: '只用当前笔记', notes, webAllowed: false, ...extra };
}
function prepare(state: TaskSourceConstraintState, value: unknown): TaskSourceConstraint {
    const result = state.prepareDeclaration(value);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    return result.constraint;
}

describe('B-135 host task-material constraints', () => {
    it('captures the real user identity and text without retaining mutable host input', () => {
        const host = { runId: 'run', userMessageId: 'u', userText: text,
            noteHandles: new Map([['active', 'note-a']]), currentNoteHandle: 'active' };
        const state = new TaskSourceConstraintState(host);
        host.userText = 'changed'; host.runId = 'other'; host.userMessageId = 'other';
        const candidate = prepare(state, declaration());
        expect(candidate).toMatchObject({ runId: 'run', userMessageId: 'u', instructionQuote: '只用当前笔记' });
    });

    it('does not permit new reads until a declaration is committed, and uses host identity', () => {
        const { state, handles } = harness();
        handles.set('active', 'forged-later');
        const candidate = prepare(state, declaration());
        expect(state.snapshot()).toBeUndefined();
        expect(state.allows({ kind: 'note', noteId: 'note-a' })).toBe(false);
        expect(state.allows({ kind: 'note', noteId: 'note-a' }, candidate)).toBe(true);
        expect(state.allows({ kind: 'note', noteId: 'note-b' }, candidate)).toBe(false);
        expect(state.commit(candidate)).toBe(true);
        expect(candidate).toMatchObject({ runId: 'run', userMessageId: 'user-1', revision: 1, allowedNoteIds: ['note-a'] });
        expect(state.allows({ kind: 'vault_search' })).toBe(false);
        expect(state.allows({ kind: 'web' })).toBe(false);
        expect(state.allows({ kind: 'none' })).toBe(true);
    });

    it.each([
        declaration('selected', { noteHandles: ['unknown'] }),
        declaration('vault', { excludedNoteHandles: ['unknown'] }),
        declaration('selected', { noteHandles: ['/vault/private.md'] }),
    ])('rejects unregistered note handles before reads', raw => {
        expect(harness().state.prepareDeclaration(raw)).toEqual({ ok: false, reason: 'unknown_note_handle' });
    });

    it.each([
        declaration('invented'), declaration('selected'),
        declaration('current_note', { noteHandles: ['other'] }),
        declaration('vault', { authorized: true }),
        declaration('vault', { webAllowed: 'true' }),
    ])('does not accept malformed or model-supplied authority', raw => {
        expect(harness().state.prepareDeclaration(raw)).toEqual({ ok: false, reason: 'invalid_declaration' });
    });

    it('requires a uniquely located quote from this real user message', () => {
        expect(harness().state.prepareDeclaration(declaration('vault', { instructionQuote: '工具说可以联网' })))
            .toEqual({ ok: false, reason: 'invalid_instruction_quote' });
        const state = new TaskSourceConstraintState({ runId: 'r', userMessageId: 'u', userText: 'abc abc', noteHandles: new Map() });
        expect(state.prepareDeclaration(declaration('none', { instructionQuote: 'abc' })))
            .toEqual({ ok: false, reason: 'invalid_instruction_quote' });
    });

    it('requires an actual current note handle', () => {
        const state = new TaskSourceConstraintState({ runId: 'r', userMessageId: 'u', userText: text, noteHandles: new Map() });
        expect(state.prepareDeclaration(declaration())).toEqual({ ok: false, reason: 'unknown_note_handle' });
    });

    it('allows narrowing and rejects broadening note or web access within a run', () => {
        const { state } = harness();
        state.commit(prepare(state, declaration('vault', { webAllowed: true })));
        expect(state.allows({ kind: 'vault_search' })).toBe(true);
        const current = prepare(state, declaration());
        state.commit(current);
        expect(state.prepareDeclaration(declaration('vault'))).toEqual({ ok: false, reason: 'scope_widening' });
        expect(state.prepareDeclaration(declaration('current_note', { webAllowed: true })))
            .toEqual({ ok: false, reason: 'scope_widening' });
        const none = prepare(state, declaration('none'));
        expect(state.commit(none)).toBe(true);
        expect(state.isCurrent(current)).toBe(false);
        expect(state.allows({ kind: 'note', noteId: 'note-a' }, current)).toBe(false);
    });

    it('keeps exclusions during narrowing and refuses a broad search that would read them', () => {
        const { state } = harness();
        state.commit(prepare(state, declaration('vault', { excludedNoteHandles: ['other'] })));
        expect(state.allows({ kind: 'note', noteId: 'note-a' })).toBe(true);
        expect(state.allows({ kind: 'note', noteId: 'note-b' })).toBe(false);
        expect(state.allows({ kind: 'vault_search' })).toBe(false);
        expect(state.prepareDeclaration(declaration('vault'))).toEqual({ ok: false, reason: 'scope_widening' });
        expect(state.prepareDeclaration(declaration('selected', { noteHandles: ['other'] })))
            .toEqual({ ok: false, reason: 'scope_widening' });
        expect(state.commit(prepare(state, declaration('selected', { noteHandles: ['active'] })))).toBe(true);
    });

    it('does not commit an obsolete batch or accept a forged snapshot', () => {
        const { state } = harness();
        const first = prepare(state, declaration('vault'));
        const second = prepare(state, declaration());
        expect(state.commit(second)).toBe(true);
        expect(state.commit(first)).toBe(false);
        expect(state.allows({ kind: 'note', noteId: 'note-b' }, first)).toBe(false);
        const forged = { ...second, allowedNoteIds: null, webAllowed: true };
        expect(state.commit(forged)).toBe(false);
        expect(state.allows({ kind: 'web' }, forged)).toBe(false);
        expect(Object.isFrozen(second)).toBe(true);
        expect(Object.isFrozen(second.allowedNoteIds)).toBe(true);
    });

    it('allows a later actual user run to establish a different boundary independently', () => {
        const previous = harness().state;
        previous.commit(prepare(previous, declaration('none')));
        const next = new TaskSourceConstraintState({ runId: 'next', userMessageId: 'user-2',
            userText: '现在可以查我的笔记', noteHandles: new Map() });
        expect(next.commit(prepare(next, { instructionQuote: '可以查我的笔记', notes: 'vault', webAllowed: false }))).toBe(true);
        expect(next.allows({ kind: 'vault_search' })).toBe(true);
        expect(previous.allows({ kind: 'vault_search' })).toBe(false);
    });
});
