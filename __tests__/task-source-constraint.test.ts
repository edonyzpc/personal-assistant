import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';
import type { ChatSourceScope } from '../src/ai-services/chat-source-scope';

function state(sourceScope?: ChatSourceScope) {
    return new TaskSourceConstraintState({ runId: 'run', userMessageId: 'user',
        userText: '只用当前笔记', requestText: '只用当前笔记\n[app context]',
        noteHandles: new Map([['current', 'note-a']]), sourceScope });
}

describe('Task source Host admission', () => {
    it.each([
        { sourceScope: 'notes' as const, notes: true, web: false },
        { sourceScope: 'web' as const, notes: false, web: true },
        { sourceScope: 'combined' as const, notes: true, web: true },
    ])('intersects $sourceScope with every note, search and web read', ({ sourceScope, notes, web }) => {
        const admission = state(sourceScope);
        expect(admission.allows({ kind: 'note', noteId: 'note-a' })).toBe(notes);
        expect(admission.allows({ kind: 'vault_search' })).toBe(notes);
        expect(admission.allows({ kind: 'scoped_vault_search' })).toBe(notes);
        expect(admission.allows({ kind: 'web' })).toBe(web);
    });
    it('starts with one fixed admission and binds it to the complete request identity', () => {
        const admission = state();
        const snapshot = admission.snapshot();
        expect(snapshot).toMatchObject({ runId: 'run', userMessageId: 'user', revision: 1,
            allowedNoteIds: null, excludedNoteIds: [], webAllowed: true });
        expect(admission.matchesRun('run', '只用当前笔记\n[app context]')).toBe(true);
        expect(admission.matchesRun('run', '只用当前笔记')).toBe(false);
        expect(admission.matchesRun('other', '只用当前笔记\n[app context]')).toBe(false);
        expect(admission.snapshot()).toBe(snapshot);
    });

    it('does not let model-shaped or copied snapshots authorize a read', () => {
        const admission = state();
        const snapshot = admission.snapshot();
        expect(admission.allows({ kind: 'note', noteId: 'note-a' })).toBe(true);
        expect(admission.allows({ kind: 'vault_search' })).toBe(true);
        expect(admission.allows({ kind: 'web' })).toBe(true);
        expect(admission.allows({ kind: 'note', noteId: 'note-a' }, { ...snapshot })).toBe(false);
        expect(admission.allows({ kind: 'web' }, { ...snapshot })).toBe(false);
    });

    it('registers a real discovered identity without changing admission', () => {
        const admission = state();
        const snapshot = admission.snapshot();
        expect(admission.registerNoteHandle('linked', 'note-b')).toBe(true);
        expect(admission.registerNoteHandle('linked', 'note-b')).toBe(true);
        expect(admission.registerNoteHandle('linked', 'note-c')).toBe(false);
        expect(admission.snapshot()).toBe(snapshot);
    });

    it('keeps a captured read guard bound to Host lifetime and exact snapshot', () => {
        const admission = state();
        let current = true;
        const guard = admission.createReadGuard(admission.snapshot(),
            path => path === 'a.md' ? 'note-a' : undefined, () => current);
        expect(guard.isPathAllowed('a.md')).toBe(true);
        expect(guard.isPathAllowed('missing.md')).toBe(false);
        current = false;
        expect(guard.isCurrent()).toBe(false);
        expect(guard.isPathAllowed('a.md')).toBe(false);
    });
});
