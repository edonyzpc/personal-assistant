import type { Workspace } from 'obsidian';
import type { MarkdownViewLike, VaultFileLike } from '../src/ai-services/chat-tool-execution-helpers';
import type { ParsedBufferedToolCall } from '../src/ai-services/pa-agent-types';
import type { TaskSourceConstraint } from '../src/ai-services/task-source-constraint';
import type { ChatMessage, PaAgentMessage } from '../src/ai-services/chat-types';
import { createTaskSourceConstrainedExecutor } from '../src/ai-services/task-source-executor';
import { completeInputLineage, toGenerationInputLineage, unknownInputLineage, type InputLineage } from '../src/ai-services/input-lineage';
import type { PaAgentActionState } from '../src/ai-services/pa-agent-result-facts';
import { ChatHistoryManager } from '../src/chat/chat-history-manager';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import {
    MAX_TASK_SOURCE_NOTE_DIRECTORY_CHARS,
    MAX_TASK_SOURCE_NOTE_HANDLES,
    TaskSourceRun,
    type TaskSourceRunHost,
} from '../src/ai-services/task-source-run';

jest.mock('obsidian');

const userText = '请查找资料并回答';

function imageState(lineage: InputLineage): PaAgentActionState {
    return { schemaVersion: 1, owner: 'image', operationId: 'task-1', phase: 'accepted', revision: 0,
        origin: { runId: 'run-1', turnId: 'turn-1', assistantId: 'a-1', callId: 'c-1', resultId: 'r-1' },
        receipt: { kind: 'image-accepted', taskId: 'task-1' }, inputLineage: lineage };
}

describe('B157 independently admitted historical state', () => {
    it.each([false, true])('admits original bound state after real manager rehydration; async=%s', async asynchronous => {
        const h = fixture();
        const manager = new ChatHistoryManager({ store: new MemoryChatHistoryStore() });
        const lineage = completeInputLineage([{ kind: 'user-text', messageId: 'original' },
            { kind: 'run-notes-observation', runId: 'run-1', owner: 'vault', sourceEpoch: 'epoch-1' }]);
        const saved = imageState(lineage);
        const restored = manager.deserializeTurn({ conversationId: 'conversation', turnIndex: 2,
            user: { role: 'user', content: 'Generate', hostProvenance: { version: 1, kind: 'ordinary_user_statement', messageId: 'original' } },
            assistant: { role: 'assistant', content: 'PRIVATE_OLD_TEXT', inputLineage: lineage, actionStates: [saved],
                actionStateBinding: { conversationId: 'conversation', turnIndex: 2, runId: 'run-1', turnId: 'turn-1' } } });
        const run = new TaskSourceRun({ ...h.host, runId: 'run-2', conversationId: 'conversation',
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'notes', userMessageId: 'user-1' },
            ...(asynchronous ? { getTaskSourceAuthorityEpoch: () => 'authority' } : {}) });
        const history = [restored.userMessage, restored.assistantMessage];
        const project = () => asynchronous ? run.projectHistoryAsync(history) : Promise.resolve(run.projectHistory(history));
        expect(restored.assistantMessage.canonicalTurn?.turnId).toBe('rehydrated:conversation:2');
        expect((await project()).flatMap(message => message.actionStates ?? [])).toEqual([saved]);
        expect(JSON.stringify(await project())).not.toContain('PRIVATE_OLD_TEXT');
        for (const invalidId of ['rehydrated:foreign:2', 'rehydrated:conversation:3', 'forged']) {
            restored.assistantMessage.canonicalTurn!.runId = invalidId;
            restored.assistantMessage.canonicalTurn!.turnId = invalidId;
            expect((await project()).flatMap(message => message.actionStates ?? [])).toEqual([]);
        }
        const canonical = restored.assistantMessage.canonicalTurn!;
        canonical.runId = 'rehydrated:conversation:2';
        expect((await project()).flatMap(message => message.actionStates ?? [])).toEqual([]);
        canonical.turnId = canonical.runId;
        canonical.messages = [{ role: 'assistant', id: 'forged', timestamp: 1,
            content: [{ type: 'text', text: 'FORGED_TRANSCRIPT' }] }];
        expect((await project()).flatMap(message => message.actionStates ?? [])).toEqual([]);
        canonical.messages = [];
        restored.assistantMessage.actionStateBinding!.runId = 'foreign-owner';
        expect((await project()).flatMap(message => message.actionStates ?? [])).toEqual([]);
    });
    it.each([false, true])('rejects altered historical owner proof and current authority changes; async=%s', async asynchronous => {
        for (const scenario of ['conversation', 'run', 'turn', 'missing-user', 'duplicate-user', 'unknown', 'foreign-observation', 'epoch', 'epoch-unavailable', 'memory', 'scope', 'revoked', 'vault-path', 'limited', 'excluded']) {
            const h = fixture();
            const host: TaskSourceRunHost = { ...h.host, conversationId: 'conversation', runId: 'run-2',
                runSourceSelection: { schemaVersion: 1, scope: scenario === 'scope' ? 'web' : 'notes', selectionId: 'scope', userMessageId: 'user-1' },
                ...(asynchronous ? { getTaskSourceAuthorityEpoch: () => 'authority' } : {}),
                ...(scenario === 'epoch-unavailable' ? { getMemoryEvidenceEpoch: () => { throw new Error('Unavailable'); } } : {}),
                ...(scenario === 'vault-path' ? { isPathAllowed: () => false } : {}) };
            const run = new TaskSourceRun(host);
            const dependencies: InputLineage['dependencies'] = [{ kind: 'user-text', messageId: 'original' },
                { kind: 'run-notes-observation', runId: scenario === 'foreign-observation' ? 'foreign-run' : 'run-1',
                    owner: 'memory', sourceEpoch: 'epoch-1', memoryEnabled: true },
                { kind: 'vault', path: h.a.path, via: 'note' }];
            const lineage = scenario === 'unknown' ? unknownInputLineage(dependencies) : completeInputLineage(dependencies);
            const saved = imageState(lineage);
            const user: ChatMessage = { role: 'user', content: 'original', hostProvenance: { version: 1, kind: 'ordinary_user_statement', messageId: 'original' } };
            const assistant: ChatMessage = { role: 'assistant', content: 'PRIVATE_PROSE', inputLineage: unknownInputLineage(), actionStates: [saved],
                actionStateBinding: { conversationId: scenario === 'conversation' ? 'foreign-conversation' : 'conversation', turnIndex: 0,
                    runId: scenario === 'run' ? 'foreign-run' : 'run-1', turnId: scenario === 'turn' ? 'foreign-turn' : 'turn-1' } };
            const history = scenario === 'missing-user' ? [assistant] : scenario === 'duplicate-user' ? [user, user, assistant] : [user, assistant];
            if (scenario === 'epoch') h.setSourceEpoch('epoch-2');
            if (scenario === 'memory') h.setMemoryAllowed(false);
            if (scenario === 'revoked') h.setCurrent(false);
            if (scenario === 'limited' || scenario === 'excluded') {
                // Represent a real internal restricted snapshot, not a caller-created read grant.
                const current = run.state.snapshot();
                Reflect.set(run.state, 'current', Object.freeze({ ...current,
                    allowedNoteIds: scenario === 'limited' ? [] : null, excludedNoteIds: scenario === 'excluded' ? ['excluded'] : [] }));
            }
            if (asynchronous && scenario === 'revoked') {
                await expect(run.projectHistoryAsync(history)).rejects.toThrow('Task source scope changed');
                continue;
            }
            const projected = asynchronous ? await run.projectHistoryAsync(history) : run.projectHistory(history);
            expect(projected.flatMap(message => message.actionStates ?? [])).toEqual([]);
            expect(JSON.stringify(projected)).not.toContain('PRIVATE_PROSE');
        }
    });
    it.each([false, true])('projects only bound historical owner state with current observation evidence; async=%s', async asynchronous => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, runId: 'run-2', conversationId: 'conversation',
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'notes', userMessageId: 'user-1' },
            ...(asynchronous ? { getTaskSourceAuthorityEpoch: () => 'authority-1' } : {}) });
        const lineage = completeInputLineage([{ kind: 'user-text', messageId: 'original-user' },
            { kind: 'run-notes-observation', runId: 'run-1', owner: 'vault', sourceEpoch: 'epoch-1' }]);
        const saved: PaAgentActionState = { schemaVersion: 1, owner: 'writing', operationId: 'writing', phase: 'completed', revision: 1,
            origin: { runId: 'run-1', turnId: 'turn-1', assistantId: 'assistant', resultId: 'assistant' }, inputLineage: lineage,
            receipt: { kind: 'writing-saves', versionId: 'writing', saves: [{ saveId: 'save', state: 'completed', noteState: 'completed' }] } };
        const history: ChatMessage[] = [{ role: 'user', content: 'Write', hostProvenance: { version: 1, kind: 'writing_request', messageId: 'original-user' },
            inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'original-user' }]) },
            { role: 'assistant', content: 'OLD_PRIVATE_PROSE', inputLineage: lineage, actionStates: [saved],
                hostProvenance: { version: 1, kind: 'ai_draft', messageId: 'original-assistant' },
                actionStateBinding: { conversationId: 'conversation', turnIndex: 0, runId: 'run-1', turnId: 'turn-1' } }];
        const project = (messages: ChatMessage[]) => asynchronous ? run.projectHistoryAsync(messages) : Promise.resolve(run.projectHistory(messages));
        const original = JSON.stringify(history);
        expect(run.admitsLineage(lineage, true)).toBe(false);
        const projected = await project(history);
        const fragment = projected.find(message => message.role === 'assistant')!;
        expect(fragment).toBeDefined();
        expect(fragment.content).toBe('');
        expect(fragment.actionStates).toEqual([saved]);
        expect(fragment.actionStateBinding).toEqual(history[1].actionStateBinding);
        expect(fragment.hostProvenance).toEqual(history[1].hostProvenance);
        expect(fragment.inputLineage?.dependencies).toContainEqual({ kind: 'run-notes-observation', runId: 'run-2', owner: 'vault', sourceEpoch: 'epoch-1' });
        expect(run.admitsLineage(fragment.inputLineage, true)).toBe(true);
        expect(await project([fragment])).toEqual([fragment]);
        expect(run.isOwnedHistoricalActionFragment(fragment)).toBe(true);
        expect((await project([{ ...fragment }])).flatMap(message => message.actionStates ?? [])).toEqual([]);
        const tampered = { ...fragment, content: 'OLD_PRIVATE_PROSE' };
        expect(JSON.stringify(await project([tampered]))).not.toContain('OLD_PRIVATE_PROSE');
        const binding = fragment.actionStateBinding!;
        fragment.actionStateBinding = { ...binding, conversationId: 'other-conversation' };
        expect(await project([fragment])).toEqual([]);
        fragment.actionStateBinding = binding;
        expect(await project([fragment])).toEqual([fragment]);
        expect(JSON.stringify(projected)).not.toContain('OLD_PRIVATE_PROSE');
        expect(JSON.stringify(history)).toBe(original);
        h.setSourceEpoch('epoch-2');
        expect(await project([fragment])).toEqual([]);
    });
    it('does not restore legacy privileges if authority becomes temporarily unavailable in strict async admission', async () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, isPathAllowed: () => false,
            getTaskSourceAuthorityEpoch: () => { throw new Error('Authority temporarily unavailable'); } });
        const lineage = completeInputLineage([{ kind: 'vault', path: h.a.path, via: 'note' }]);
        expect(run.admitsLineage(lineage, true)).toBe(false);
        expect(await run.admitsLineageAsync(lineage, undefined, true)).toBe(false);
    });
    it.each([false, true])('rejects unknown and excluded state even for legacy prose; async epoch=%s', async epoch => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, isPathAllowed: path => path !== h.a.path,
            ...(epoch ? { getTaskSourceAuthorityEpoch: () => 'epoch-1' } : {}) });
        for (const lineage of [unknownInputLineage(), completeInputLineage([{ kind: 'vault', path: h.a.path, via: 'note' }])]) {
            const message: ChatMessage = { role: 'assistant', content: 'legacy prose', actionStates: [imageState(lineage)] };
            expect(run.projectHistory([message])[0].actionStates).toEqual([]);
            expect((await run.projectHistoryAsync([message]))[0].actionStates).toEqual([]);
        }
    });

    it('keeps only a proved state when the whole assistant and canonical bodies have unknown ancestry', async () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, getTaskSourceAuthorityEpoch: () => 'epoch-1',
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'notes-1', userMessageId: 'user-1' } });
        const state = imageState(completeInputLineage([{ kind: 'user-text', messageId: 'user-1' }]));
        const message: ChatMessage = { role: 'assistant', content: 'PRIVATE_SENTINEL', inputLineage: unknownInputLineage(),
            canonicalTurn: { schemaVersion: 1, runId: 'run-1', turnId: 'turn-1', actionStates: [state], messages: [
                { role: 'assistant', id: 'a-private', timestamp: 1, content: [
                    { type: 'text', text: 'PRIVATE_CANONICAL' },
                    { type: 'toolCall', id: 'c-private', name: 'query_notes', input: { path: 'PRIVATE_PATH' } },
                ] },
            ] } };
        const original = JSON.stringify(message);
        for (const projected of [run.projectHistory([message]), await run.projectHistoryAsync([message])]) {
            expect(projected).toHaveLength(1);
            expect(projected[0].actionStates).toEqual([state]);
            expect(JSON.stringify(projected)).not.toContain('PRIVATE_');
            expect(projected[0].inputLineage?.completeness).toBe('complete');
        }
        expect(JSON.stringify(message)).toBe(original);
    });
});

function fixture(currentPath = 'notes/a.md') {
    const a: VaultFileLike = { path: currentPath };
    const b: VaultFileLike = { path: 'notes/b.md' };
    const canvas: VaultFileLike = { path: 'notes/board.canvas' };
    const files = new Map<string, VaultFileLike>([[a.path, a], [b.path, b], [canvas.path, canvas]]);
    let active: MarkdownViewLike | null = { file: a };
    let current = true;
    let sourceEpoch = 'epoch-1';
    let memoryAllowed = true;
    const workspace = {
        getActiveViewOfType: jest.fn((_type: unknown) => active),
        getMostRecentLeaf: jest.fn(() => null),
        getLeavesOfType: jest.fn((_type: string) => []),
    } as unknown as Workspace;
    const getFileByPath = jest.fn((path: string): unknown => files.get(path));
    const host: TaskSourceRunHost = { runId: 'run-1', userMessageId: 'user-1', userText,
        workspace, getFileByPath, isCurrent: () => current,
        getMemoryEvidenceEpoch: () => sourceEpoch, isMemoryAllowed: () => memoryAllowed };
    return { a, b, canvas, files, host, getFileByPath,
        create: () => new TaskSourceRun(host),
        setActive(view: MarkdownViewLike | null) { active = view; },
        setCurrent(value: boolean) { current = value; },
        setSourceEpoch(value: string) { sourceEpoch = value; },
        setMemoryAllowed(value: boolean) { memoryAllowed = value; },
    };
}

function contextNotes(run: TaskSourceRun): { currentNoteHandle: string | null;
    notes: { handle: string; path: string; title?: string }[] } {
    return JSON.parse(run.contextInstruction().split('\n').slice(-1)[0]);
}

function admission(run: TaskSourceRun): TaskSourceConstraint {
    return run.state.snapshot();
}

function call(id: string, name: string, input: unknown = {}): ParsedBufferedToolCall {
    return { type: 'toolCall', id, name, input, index: 0 };
}

function executorFor(run: TaskSourceRun, userInput = userText) {
    const execute = jest.fn(async () => ({ outcome: 'success' as const, promptText: 'unused' }));
    const prepareBatch = jest.fn(async () => undefined);
    const executor = createTaskSourceConstrainedExecutor({
        baseExecutor: { execute, prepareBatch }, state: run.state,
        resolveHostNoteId: run.resolveNoteId, isHostCurrent: run.isCurrent,
        resolveReadPlans: run.resolveReadPlans, resolveNoteSearchScope: run.resolveNoteSearchScope,
    });
    return { execute, prepareBatch, preflight: (toolCalls: ParsedBufferedToolCall[]) => executor.preflightBatch!({
        runId: 'run-1', turnId: 'turn-1', turnIndex: 0, userInput, toolCalls,
    }) };
}

describe('Task source run host', () => {
    it.each(['notes', 'web', 'combined'] as const)('keeps cooperative admission equivalent to the complete %s admission', async scope => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, getTaskSourceAuthorityEpoch: () => 'authority-1',
            runSourceSelection: { schemaVersion: 1, scope, selectionId: 'scope-1', userMessageId: h.host.userMessageId } });
        const lineages = [undefined, unknownInputLineage(), completeInputLineage(),
            completeInputLineage([{ kind: 'user-text', messageId: 'user-1' }]),
            completeInputLineage([{ kind: 'vault', path: h.a.path, via: 'note' }]),
            completeInputLineage([{ kind: 'vault', path: h.b.path, via: 'memory' }]),
            completeInputLineage([{ kind: 'web', providerId: 'web', resultKey: 'result-1' }]),
            completeInputLineage([{ kind: 'vault', path: h.a.path, via: 'note' },
                { kind: 'web', providerId: 'web', resultKey: 'result-1' }])];
        for (const lineage of lineages) expect(await run.admitsLineageAsync(lineage)).toBe(run.admitsLineage(lineage));
        h.setMemoryAllowed(false);
        for (const lineage of lineages) expect(await run.admitsLineageAsync(lineage)).toBe(run.admitsLineage(lineage));
    });

    it.each([
        { kind: 'vault', path: 'notes/a.md', via: 'note', extra: true },
        { kind: 'forged-source', path: 'notes/a.md' },
    ])('rejects malformed ancestry before scalar admission: $kind', async dependency => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, getTaskSourceAuthorityEpoch: () => 'authority-1',
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'scope-1', userMessageId: h.host.userMessageId } });
        const lineage = { schemaVersion: 1, completeness: 'complete', dependencies: [dependency] } as InputLineage;
        expect(await run.admitsLineageAsync(lineage)).toBe(false);
    });

    it('rejects scalar ancestry when its authority callback throws', async () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, getTaskSourceAuthorityEpoch: () => 'authority-1',
            isPathAllowed: () => { throw new Error('Authority unavailable'); },
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'scope-1', userMessageId: h.host.userMessageId } });
        const lineage = completeInputLineage([{ kind: 'vault', path: h.a.path, via: 'note' }]);
        expect(await run.admitsLineageAsync(lineage)).toBe(false);
        expect(run.admitsLineage(lineage)).toBe(false);
    });

    it('rechecks an earlier dependency revoked while cooperative admission yields', async () => {
        const h = fixture();
        const paths = Array.from({ length: 500 }, (_, index) => `notes/source-${index}.md`);
        for (const path of paths) h.files.set(path, { path });
        let epoch = 1;
        const denied = new Set<string>();
        const run = new TaskSourceRun({ ...h.host, getTaskSourceAuthorityEpoch: () => String(epoch),
            isPathAllowed: path => !denied.has(path),
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'scope-1', userMessageId: h.host.userMessageId } });
        const lineage = completeInputLineage(paths.map(path => ({ kind: 'vault', path, via: 'note' })));
        setTimeout(() => { denied.add(paths[0]!); epoch += 1; }, 0);
        await expect(run.prepareLineageAdmission(lineage)).rejects.toThrow('ancestry');
        expect(run.admitsLineage(lineage)).toBe(false);
    });

    it('preserves source receipts through an ordinary edit and invalidates them on deletion', async () => {
        const h = fixture();
        const paths = Array.from({ length: 100 }, (_, index) => `notes/source-${index}.md`);
        for (const path of paths) h.files.set(path, { path });
        let epoch = 1;
        const run = new TaskSourceRun({ ...h.host, getTaskSourceAuthorityEpoch: () => String(epoch),
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'scope-1', userMessageId: h.host.userMessageId } });
        const lineage = completeInputLineage(paths.map(path => ({ kind: 'vault', path, via: 'note' })));
        setTimeout(() => { epoch += 1; }, 0);
        const proof = await run.prepareLineageAdmission(lineage);
        const legacySourceValidity = run.captureLineageSourceValidity(lineage);
        expect(proof.isCurrent()).toBe(true);
        expect(proof.sourceValidity()).toBe(true);
        expect(legacySourceValidity()).toBe(true);
        epoch += 1;
        expect(proof.isCurrent()).toBe(false);
        expect(proof.sourceValidity()).toBe(true);
        expect(legacySourceValidity()).toBe(true);
        expect((await run.prepareLineageAdmission(lineage)).isCurrent()).toBe(true);
        h.files.delete(paths[0]);
        epoch += 1;
        expect(proof.sourceValidity()).toBe(false);
        expect(legacySourceValidity()).toBe(false);
    });
    it('keeps only source-compatible history in a selected Chat run without erasing the display records', () => {
        const h = fixture();
        const history = [
            { role: 'user', content: 'EXPLICIT_USER', inputLineage: { schemaVersion: 1,
                completeness: 'complete', dependencies: [{ kind: 'user-text', messageId: 'user-old' }] } },
            { role: 'assistant', content: 'PRIVATE_NOTE', inputLineage: { schemaVersion: 1,
                completeness: 'complete', dependencies: [{ kind: 'vault', path: h.a.path, via: 'note' }] } },
            { role: 'assistant', content: 'PUBLIC_WEB', inputLineage: { schemaVersion: 1,
                completeness: 'complete', dependencies: [{ kind: 'web', providerId: 'web', resultKey: 'result-1' }] } },
            { role: 'assistant', content: 'LEGACY_UNKNOWN' },
        ] as ChatMessage[];
        const run = new TaskSourceRun({ ...h.host, runSourceSelection: {
            schemaVersion: 1, scope: 'web', selectionId: 'scope-1', userMessageId: h.host.userMessageId,
        } });

        expect(run.projectHistory(history).map(message => message.content)).toEqual(['EXPLICIT_USER', 'PUBLIC_WEB']);
        expect(history.map(message => message.content)).toEqual([
            'EXPLICIT_USER', 'PRIVATE_NOTE', 'PUBLIC_WEB', 'LEGACY_UNKNOWN',
        ]);
    });

    it('keeps a source-free Vault search observation in its creating notes run only', () => {
        const h = fixture();
        const lineage = { schemaVersion: 1, completeness: 'complete', dependencies: [
            { kind: 'run-notes-observation', runId: 'run-1', owner: 'vault', sourceEpoch: 'epoch-1' },
        ] } as unknown as Parameters<TaskSourceRun['admitsLineage']>[0];
        const notes = new TaskSourceRun({ ...h.host, runSourceSelection: {
            schemaVersion: 1, scope: 'notes', selectionId: 'notes-run', userMessageId: h.host.userMessageId,
        } });
        const web = new TaskSourceRun({ ...h.host, runSourceSelection: {
            schemaVersion: 1, scope: 'web', selectionId: 'web-run', userMessageId: h.host.userMessageId,
        } });
        const later = new TaskSourceRun({ ...h.host, runId: 'run-2', runSourceSelection: {
            schemaVersion: 1, scope: 'notes', selectionId: 'later-run', userMessageId: h.host.userMessageId,
        } });
        const result = { role: 'toolResult', id: 'empty-search', toolCallId: 'call-1',
            toolName: 'search_vault_metadata', isError: false, inputLineage: lineage,
            content: { promptText: '{"matches":[]}', includeInNextPrompt: true,
                sourceRecords: [], resultFact: { kind: 'no_match', search: 'metadata' } },
        } as unknown as PaAgentMessage;

        expect(notes.admitsLineage(lineage)).toBe(true);
        expect(toGenerationInputLineage(lineage, [])).toMatchObject({ state: 'complete',
            dependencies: [{ kind: 'vault', identity: JSON.stringify(lineage?.dependencies[0]) }] });
        expect(notes.projectTranscript([result])).toHaveLength(1);
        expect(notes.captureLineageSourceValidity(lineage)()).toBe(true);
        h.setSourceEpoch('epoch-2');
        expect(notes.admitsLineage(lineage)).toBe(false);
        expect(notes.captureLineageSourceValidity(lineage)()).toBe(false);
        expect(notes.captureRunNotesObservationLineage('vault', 'epoch-1').completeness).toBe('unknown');
        h.setSourceEpoch('epoch-1');
        expect(web.admitsLineage(lineage)).toBe(false);
        expect(web.projectTranscript([result])).toEqual([]);
        expect(later.admitsLineage(lineage)).toBe(false);
        expect(new TaskSourceRun({ ...h.host, runId: 'run-2' }).admitsLineage(lineage)).toBe(false);
        expect(new TaskSourceRun({ ...h.host, getMemoryEvidenceEpoch: undefined })
            .captureRunNotesObservationLineage('vault', 'epoch-1').completeness).toBe('unknown');
        h.setCurrent(false);
        expect(notes.captureLineageSourceValidity(lineage)()).toBe(false);
    });

    it('keeps a prior notes answer grounded only in user text in Web history', () => {
        const h = fixture();
        const web = new TaskSourceRun({ ...h.host, runId: 'run-2', runSourceSelection: {
            schemaVersion: 1, scope: 'web', selectionId: 'web-run', userMessageId: h.host.userMessageId,
        } });
        const answer = { role: 'assistant', content: 'USER_TEXT_ONLY',
            inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'old-user' }]),
            runSourceSelection: { schemaVersion: 1, scope: 'notes', selectionId: 'old-notes',
                userMessageId: 'old-user' } } as ChatMessage;

        expect(web.projectHistory([answer])).toEqual([answer]);
    });

    it('withdraws a Memory empty observation when Memory availability changes', () => {
        const h = fixture();
        const notes = new TaskSourceRun({ ...h.host, runSourceSelection: {
            schemaVersion: 1, scope: 'notes', selectionId: 'notes-run', userMessageId: h.host.userMessageId,
        } });
        const lineage = { schemaVersion: 1, completeness: 'complete', dependencies: [{
            kind: 'run-notes-observation', runId: 'run-1', owner: 'memory',
            sourceEpoch: 'epoch-1', memoryEnabled: true,
        }] } as unknown as Parameters<TaskSourceRun['admitsLineage']>[0];

        expect(notes.admitsLineage(lineage)).toBe(true);
        const current = notes.captureLineageSourceValidity(lineage);
        expect(current()).toBe(true);
        h.setMemoryAllowed(false);
        expect(notes.admitsLineage(lineage)).toBe(false);
        expect(current()).toBe(false);
        const unavailable = notes.captureRunNotesObservationLineage('memory', 'epoch-1', false);
        expect(unavailable.completeness).toBe('complete');
        expect(notes.admitsLineage(unavailable)).toBe(true);
        h.setMemoryAllowed(true);
        expect(notes.admitsLineage(unavailable)).toBe(false);
    });

    it('does not carry an older notes answer with a recorded empty tool observation into Web history', () => {
        const h = fixture();
        const web = new TaskSourceRun({ ...h.host, runId: 'run-2', runSourceSelection: {
            schemaVersion: 1, scope: 'web', selectionId: 'web-run', userMessageId: h.host.userMessageId,
        } });
        const history = [{ role: 'assistant', content: 'NO_MATCH_FROM_OLD_NOTES_RUN',
            inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'old-user' }]), runSourceSelection: {
                schemaVersion: 1, scope: 'notes', selectionId: 'old-notes', userMessageId: 'old-user',
            }, canonicalTurn: { schemaVersion: 1, runId: 'old-run', turnId: 'old-turn', messages: [{
                role: 'toolResult', id: 'old-empty-search', toolCallId: 'old-call',
                toolName: 'search_vault_metadata', isError: false, timestamp: 0,
                content: { promptText: '{"tool":"search_vault_metadata","status":"ok","observation":{"query":"x","matches":[]}}',
                    includeInNextPrompt: true, metadata: { outcome: 'success' }, sourceRecords: [] },
            } as PaAgentMessage] } }] as ChatMessage[];

        expect(web.projectHistory(history)).toEqual([]);
    });

    it('binds only paths actually printed in the note directory to their current availability', () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, runSourceSelection: {
            schemaVersion: 1, scope: 'notes', selectionId: 'notes-run', userMessageId: h.host.userMessageId,
        } });
        const directory = run.captureContextInstruction();
        expect(directory.instruction).toContain(h.a.path);
        expect(directory.paths).toContain(h.a.path);
        expect(directory.paths).not.toContain(h.b.path);
        expect(directory.isCurrent()).toBe(true);
        h.files.delete(h.a.path);
        expect(directory.isCurrent()).toBe(false);
    });

    it('separates the physical attempt from a retained source-only Writing receipt', () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, areSourcesCurrent: () => true,
            runSourceSelection: { schemaVersion: 1, scope: 'notes',
                selectionId: 'writing-run', userMessageId: h.host.userMessageId } });
        const directory = run.captureContextInstruction();
        expect(directory.paths).toContain(h.a.path);
        expect(directory.isAttemptCurrent()).toBe(true);
        h.setCurrent(false);
        expect(directory.isAttemptCurrent()).toBe(false);
        expect(directory.isCurrent()).toBe(true);
        h.files.delete(h.a.path);
        expect(directory.isCurrent()).toBe(false);
    });

    it('keeps an accepted image source receipt valid across Chat context reset until its file identity changes', () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, runSourceSelection: {
            schemaVersion: 1, scope: 'notes', selectionId: 'image-run', userMessageId: h.host.userMessageId,
        } });
        const lineage = completeInputLineage([
            { kind: 'user-text', messageId: h.host.userMessageId },
            { kind: 'vault', path: h.a.path, via: 'note' },
        ]);
        const receipt = run.captureImageTaskSourceValidity(lineage);
        expect(receipt()).toBe(true);

        h.setCurrent(false);
        expect(run.captureLineageSourceValidity(lineage)()).toBe(false);
        expect(receipt()).toBe(true);

        h.files.delete(h.a.path);
        expect(receipt()).toBe(false);
        const replacement = { path: h.a.path };
        h.files.set(h.a.path, replacement);
        expect(receipt()).toBe(false);
    });

    it('rejects a Web-only image lineage before capture and keeps unknown Regenerate proof ineligible', () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, runSourceSelection: {
            schemaVersion: 1, scope: 'web', selectionId: 'image-web-run', userMessageId: h.host.userMessageId,
        } });
        const notesLineage = completeInputLineage([
            { kind: 'user-text', messageId: h.host.userMessageId },
            { kind: 'vault', path: h.a.path, via: 'note' },
        ]);
        expect(run.admitsLineage(notesLineage)).toBe(false);
        expect(run.captureImageTaskSourceValidity(notesLineage)()).toBe(false);

        const unknownLineage = unknownInputLineage([
            { kind: 'user-text', messageId: h.host.userMessageId },
        ]);
        expect(run.admitsLineage(unknownLineage)).toBe(false);
        expect(run.captureImageTaskSourceValidity(unknownLineage)).toBeDefined();
        expect(run.captureImageTaskSourceValidity(unknownLineage)()).toBe(false);
    });

    it('keeps a pure user-text web instruction current when the optional Web capability is off', () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, isWebAllowed: () => false, runSourceSelection: {
            schemaVersion: 1, scope: 'web', selectionId: 'web-run', userMessageId: h.host.userMessageId,
        } });
        const directory = run.captureContextInstruction();
        expect(directory.paths).toEqual([]);
        expect(directory.isCurrent()).toBe(true);
        expect(run.admitsLineage(completeInputLineage([{ kind: 'user-text', messageId: 'current-user' }]))).toBe(true);
    });

    it('does not replace a damaged recorded user ancestry with its raw-text provenance', () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, runSourceSelection: {
            schemaVersion: 1, scope: 'web', selectionId: 'web-run', userMessageId: h.host.userMessageId,
        } });
        const user = { role: 'user', content: 'PRIVATE_BACKGROUND_SENTINEL',
            hostProvenance: { version: 1, messageId: 'user-old', kind: 'ordinary_user_statement' },
            inputLineage: { schemaVersion: 1, completeness: 'complete', dependencies: [
                { kind: 'vault', path: h.a.path, via: 'invalid' },
            ] },
        } as unknown as ChatMessage;

        expect(run.projectHistory([user])).toEqual([]);
        expect(user.content).toBe('PRIVATE_BACKGROUND_SENTINEL');
    });

    it.each(['notes', 'web', 'combined'] as const)(
        'rechecks all three target scopes for history originally captured in %s', (origin) => {
            const h = fixture();
            const user = { kind: 'user-text' as const, messageId: 'old-user' };
            const note = { kind: 'vault' as const, path: h.a.path, via: 'note' as const };
            const web = { kind: 'web' as const, providerId: 'web', resultKey: 'hit-1' };
            const history = [
                { role: 'user', content: 'USER', dependencies: [user] },
                { role: 'assistant', content: 'NOTE', dependencies: [note] },
                { role: 'assistant', content: 'WEB', dependencies: [web] },
                { role: 'assistant', content: 'MIXED', dependencies: [note, web] },
            ].map(({ role, content, dependencies }) => ({ role, content,
                inputLineage: { schemaVersion: 1, completeness: 'complete', dependencies },
                hostProvenance: { version: 1, messageId: `from-${origin}`, kind: 'ai_draft' },
            })) as ChatMessage[];
            history.push({ role: 'assistant', content: 'UNKNOWN' });
            for (const [target, expected] of [
                ['notes', ['USER', 'NOTE']],
                ['web', ['USER', 'WEB']],
                ['combined', ['USER', 'NOTE', 'WEB', 'MIXED']],
            ] as const) {
                const run = new TaskSourceRun({ ...h.host, runSourceSelection: {
                    schemaVersion: 1, scope: target, selectionId: `${origin}:${target}`,
                    userMessageId: h.host.userMessageId,
                } });
                expect(run.projectHistory(history).map(message => message.content)).toEqual(expected);
                if (target === 'web') expect(run.contextInstruction()).not.toContain(h.a.path);
            }
            const disabledWeb = new TaskSourceRun({ ...h.host, isWebAllowed: () => false,
                runSourceSelection: { schemaVersion: 1, scope: 'combined',
                    selectionId: `${origin}:disabled`, userMessageId: h.host.userMessageId } });
            expect(disabledWeb.projectHistory(history).map(message => message.content)).toEqual(['USER', 'NOTE']);
            h.files.delete(h.a.path);
            const revokedNote = new TaskSourceRun({ ...h.host, runSourceSelection: {
                schemaVersion: 1, scope: 'combined', selectionId: `${origin}:revoked`,
                userMessageId: h.host.userMessageId } });
            expect(revokedNote.projectHistory(history).map(message => message.content)).toEqual(['USER', 'WEB']);
        },
    );

    it('drops a mixed assistant call together with an independently admitted web result that echoed its private query', async () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, getTaskSourceAuthorityEpoch: () => 'authority-1', runSourceSelection: {
            schemaVersion: 1, scope: 'web', selectionId: 'web-run', userMessageId: h.host.userMessageId,
        } });
        const mixed = completeInputLineage([
            { kind: 'vault', path: h.a.path, via: 'note' },
            { kind: 'web', providerId: 'web', resultKey: 'hit' },
        ]);
        const assistant: PaAgentMessage = { role: 'assistant', id: 'assistant', timestamp: 1,
            inputLineage: mixed,
            content: [{ type: 'toolCall', id: 'call-web', name: 'search_web', input: { query: 'PRIVATE_QUERY' } }] };
        const result: PaAgentMessage = { role: 'toolResult', id: 'result', timestamp: 2,
            toolCallId: 'call-web', toolName: 'search_web', isError: false,
            inputLineage: completeInputLineage([{ kind: 'web', providerId: 'web', resultKey: 'hit' }]),
            content: { includeInNextPrompt: true, promptText: 'PRIVATE_QUERY; PUBLIC_RESULT' } };
        expect(run.projectTranscript([assistant, result])).toEqual([]);
        expect(await run.projectTranscriptAsync([assistant, result])).toEqual(run.projectTranscript([assistant, result]));
        expect(assistant.content).toHaveLength(1);
        expect(result.content.promptText).toContain('PRIVATE_QUERY');
    });

    it.each(['notes', 'web', 'combined'] as const)('keeps cooperative %s history projection equivalent to the original scope rules', async scope => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host, getTaskSourceAuthorityEpoch: () => 'authority-1',
            isWebAllowed: () => true, runSourceSelection: { schemaVersion: 1, scope,
                selectionId: 'scope-1', userMessageId: h.host.userMessageId } });
        const note = { kind: 'vault' as const, path: h.a.path, via: 'note' as const };
        const web = { kind: 'web' as const, providerId: 'web', resultKey: 'hit' };
        const history: ChatMessage[] = [
            { role: 'user', content: 'USER', inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user-1' }]) },
            { role: 'assistant', content: 'UNKNOWN' },
            { role: 'assistant', content: 'NOTE', inputLineage: completeInputLineage([note]) },
            { role: 'assistant', content: 'WEB', inputLineage: completeInputLineage([web]) },
            { role: 'assistant', content: 'MIXED', inputLineage: completeInputLineage([note, web]) },
        ];
        expect(await run.projectHistoryAsync(history)).toEqual(run.projectHistory(history));
        h.files.delete(h.a.path);
        expect(await run.projectHistoryAsync(history)).toEqual(run.projectHistory(history));
    });

    it('reprojects an earlier transcript source revoked while a later source list yields', async () => {
        const h = fixture();
        let epoch = 1;
        const run = new TaskSourceRun({ ...h.host, getTaskSourceAuthorityEpoch: () => String(epoch) });
        const first: PaAgentMessage = { role: 'toolResult', id: 'first', toolCallId: 'first-call',
            toolName: 'read_note', timestamp: 1, isError: false, content: {
                promptText: 'EARLIER_PRIVATE_TEXT', includeInNextPrompt: true,
                sourceRecords: [{ kind: 'context-used', dedupKey: 'a', path: h.a.path, sourceBoundary: 'vault' }],
            } };
        const later: PaAgentMessage = { role: 'toolResult', id: 'later', toolCallId: 'later-call',
            toolName: 'query_notes', timestamp: 2, isError: false, content: {
                promptText: 'OTHER_VALID_TEXT', includeInNextPrompt: true,
                sourceRecords: Array.from({ length: 100 }, (_, index) => ({ kind: 'context-used' as const,
                    dedupKey: `b-${index}`, path: h.b.path, sourceBoundary: 'vault' as const })),
            } };
        setTimeout(() => { h.files.delete(h.a.path); epoch += 1; }, 0);
        const projected = await run.projectTranscriptAsync([first, later]);
        expect(projected).toEqual(run.projectTranscript([first, later]));
        expect(projected[0]?.role === 'toolResult' && projected[0].content.promptText).not.toContain('EARLIER_PRIVATE_TEXT');
        expect(first.content.promptText).toBe('EARLIER_PRIVATE_TEXT');
    });

    it('retains governed Personal history only while its claim revision remains live', () => {
        const h = fixture();
        let active = true;
        const run = new TaskSourceRun({ ...h.host,
            isPersonalAllowed: source => active && source.revisions[0]?.revisionId === 'revision-1',
            runSourceSelection: { schemaVersion: 1, scope: 'combined',
                selectionId: 'personal-run', userMessageId: h.host.userMessageId } });
        const personal: ChatMessage = { role: 'assistant', content: 'PERSONAL_BUDGET',
            inputLineage: completeInputLineage([{ kind: 'personal', source: {
                state: 'identified', mode: 'governed',
                revisions: [{ claimId: 'claim-1', revisionId: 'revision-1' }],
            } }]) };
        expect(run.projectHistory([personal])).toEqual([personal]);
        active = false;
        expect(run.projectHistory([personal])).toEqual([]);
    });

    it('freezes a Chat run choice at the real user message while standalone runs keep their old policy', () => {
        const h = fixture();
        const selection = { schemaVersion: 1 as const, scope: 'web' as const,
            selectionId: 'conversation:selection:1', userMessageId: h.host.userMessageId };
        const run = new TaskSourceRun({ ...h.host, runSourceSelection: selection });
        expect(run.runSourceSelection).toEqual(selection);
        expect(Object.isFrozen(run.runSourceSelection)).toBe(true);
        expect(h.create().runSourceSelection).toBeUndefined();
        expect(h.create().state.snapshot()).toMatchObject({ allowedNoteIds: null, webAllowed: true });
        expect(() => new TaskSourceRun({ ...h.host, runSourceSelection: {
            ...selection, userMessageId: 'different-message',
        } })).toThrow('does not match');
    });

    it('admits ordinary reads and rejects retired controls in the same batch', () => {
        const h = fixture();
        const run = h.create();
        const source = run.state.snapshot();
        expect(source).toMatchObject({ allowedNoteIds: null, excludedNoteIds: [], webAllowed: true });
        expect(run.contextInstruction()).not.toContain('declare_source_scope');
        expect(executorFor(run).preflight([
            call('legacy', 'declare_source_scope', { notes: 'vault' }),
            call('read', 'read_note', { path: h.b.path }),
        ])).toMatchObject({ outcome: 'policy_rejected', metadata: { reason: 'source_control_unavailable' } });
        const admitted = executorFor(run).preflight([call('read', 'read_note', { path: h.b.path })]);
        if (!admitted || !('kind' in admitted)) throw new Error('Expected admission');
        expect(admitted.taskSourceReadGuard?.isPathAllowed(h.b.path)).toBe(true);
        h.files.set(h.b.path, { path: h.b.path });
        expect(admitted.taskSourceReadGuard?.isPathAllowed(h.b.path)).toBe(false);
    });

    it('keeps the independent Data Boundary exclusion', () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host,
            isPathAllowed: path => path !== h.b.path,
            getFileByPath: path => path === h.b.path ? undefined : h.files.get(path) });
        expect(run.resolveNoteId(h.b.path)).toBeUndefined();
        expect(executorFor(run).preflight([call('read', 'read_note', { path: h.b.path })]))
            .toMatchObject({ outcome: 'policy_rejected' });
    });

    it('preserves the excluded-current-note reason without exposing a note identity', () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host,
            isPathAllowed: path => path !== h.a.path,
            getFileByPath: path => path === h.a.path ? undefined : h.files.get(path) });
        expect(contextNotes(run).currentNoteHandle).toBeNull();
        expect(run.resolveReadPlansWithReason([call('current', 'get_current_note_context')]))
            .toEqual({ ok: false, toolCallId: 'current', reason: 'source_excluded' });
    });

    it('keeps a live linked target discoverable without publishing its source alias', () => {
        const h = fixture();
        const run = new TaskSourceRun({ ...h.host,
            getCurrentNoteLinks: () => [{ path: h.b.path }] });
        const source = run.state.snapshot();
        expect(contextNotes(run).notes.map(note => note.path)).toContain(h.b.path);
        expect(contextNotes(run).notes.find(note => note.path === h.b.path)).not.toHaveProperty('title');
        expect(run.publishAdmittedNotePaths([h.a.path], source)).toBe(true);
        expect(contextNotes(run).notes.map(note => note.path)).toContain(h.b.path);
        h.files.delete(h.b.path);
        expect(contextNotes(run).notes.map(note => note.path)).not.toContain(h.b.path);
    });

    it('captures exact projected task-source purposes without merging equal paths', () => {
        const h = fixture();
        h.a.stat = { mtime: 17, size: 29 };
        const run = h.create();
        const messages: PaAgentMessage[] = [
            { role: 'toolResult', id: 'outline-result', toolCallId: 'outline-call', toolName: 'read_note_outline',
                timestamp: 1, isError: false, content: { promptText: 'OUTLINE_BODY', includeInNextPrompt: true,
                    sourceRecords: [{ kind: 'context-used', dedupKey: 'outline:a', sourceBoundary: 'read-only-tool',
                        capabilityName: 'read_note_outline', path: h.a.path }] } },
            { role: 'toolResult', id: 'memory-result', toolCallId: 'memory-call', toolName: 'search_memory',
                timestamp: 2, isError: false, content: { promptText: 'MEMORY_BODY', includeInNextPrompt: true,
                    sourceRecords: [{ kind: 'memory-reference', dedupKey: 'memory:a', sourceBoundary: 'memory',
                        capabilityName: 'search_memory', path: h.a.path }] } },
        ];

        const captured = run.captureGenerationInputTaskSources(messages, []);

        expect(captured).toEqual({
            state: 'unknown',
            sources: [
                expect.objectContaining({ purpose: 'task_material', boundary: 'read-only-tool', dedupKey: 'outline:a',
                    capabilityName: 'read_note_outline', path: h.a.path,
                    revision: { state: 'unknown', reason: 'not_captured' } }),
                expect.objectContaining({ purpose: 'task_material', boundary: 'memory', dedupKey: 'memory:a',
                    capabilityName: 'search_memory', path: h.a.path,
                    revision: { state: 'unknown', reason: 'not_captured' } }),
            ],
        });
        expect(JSON.stringify(captured)).not.toContain('OUTLINE_BODY');
        expect(JSON.stringify(captured)).not.toContain('MEMORY_BODY');
    });

    it('marks a represented source without a stable revision as unknown and omits unrepresented history', () => {
        const run = fixture().create();
        const web: PaAgentMessage = { role: 'toolResult', id: 'web-result', toolCallId: 'web-call', toolName: 'webSearch',
            timestamp: 1, isError: false, content: { promptText: 'WEB_BODY', includeInNextPrompt: true,
                sourceRecords: [{ kind: 'web-source', dedupKey: 'web:one', sourceBoundary: 'web',
                    url: 'https://example.invalid/source' }] } };
        const omittedHistory: ChatMessage[] = [{ role: 'assistant', content: 'OMITTED_HISTORY', memoryMetadata: {
            hasMemoryContent: true, allowedMemorySourcePaths: ['notes/omitted.md'],
        } }];

        const actual = run.captureGenerationInputTaskSources([web], []);
        expect(actual).toEqual({
            state: 'unknown',
            sources: [expect.objectContaining({ dedupKey: 'web:one',
                url: 'https://example.invalid/source', revision: { state: 'unknown', reason: 'not_captured' } })],
        });
        expect(JSON.stringify(actual)).not.toContain('omitted.md');
        expect(JSON.stringify(run.captureGenerationInputTaskSources([web], omittedHistory))).toContain('omitted.md');
    });

    it('records a loaded skill from the represented provider input without treating it as Vault evidence', () => {
        const run = fixture().create();
        const skill: PaAgentMessage = { role: 'toolResult', id: 'skill-result', toolCallId: 'skill-call',
            toolName: 'load_skill', timestamp: 1, isError: false, content: {
                promptText: '<skill_body>GUIDANCE</skill_body>', includeInNextPrompt: true,
                sourceRecords: [{ kind: 'skill-guide', dedupKey: 'skill:writing', sourceBoundary: 'skill-context',
                    providerId: 'skill-context', capabilityName: 'skill-context', statusOnly: true,
                    citationEligible: false, metadata: { sourcePath: 'bundled/writing/SKILL.md' } }],
            } };

        expect(run.captureGenerationInputTaskSources([skill], [])).toEqual({
            state: 'unknown',
            sources: [expect.objectContaining({ kind: 'skill-guide', boundary: 'skill-context',
                path: 'bundled/writing/SKILL.md', revision: { state: 'unknown', reason: 'not_captured' } })],
        });
    });

    it('distinguishes missing receipts on represented legacy content from a proven empty source set', () => {
        const run = fixture().create();
        const legacyHistory: ChatMessage[] = [{ role: 'assistant', content: 'An older source-backed proposal without a receipt.' }];
        const unrecordedTool: PaAgentMessage = { role: 'toolResult', id: 'unknown-result', toolCallId: 'unknown-call',
            toolName: 'read_note_outline', timestamp: 1, isError: false, content: {
                promptText: 'A represented observation without source records.', includeInNextPrompt: true,
            } };
        const statusOnly: PaAgentMessage = { ...unrecordedTool, id: 'status-result', content: {
            promptText: 'Scope declaration accepted.', includeInNextPrompt: true, metadata: { statusOnly: true },
        } };
        const canonicalHistory: ChatMessage[] = [{ role: 'assistant', content: 'A current reply with a complete empty receipt.',
            canonicalTurn: { schemaVersion: 1, runId: 'run', turnId: 'turn', messages: [] } }];

        expect(run.captureGenerationInputTaskSources([], legacyHistory)).toEqual({ state: 'unknown', sources: [] });
        expect(run.captureGenerationInputTaskSources([unrecordedTool], [])).toEqual({ state: 'unknown', sources: [] });
        expect(run.captureGenerationInputTaskSources([statusOnly], canonicalHistory)).toEqual({ state: 'none', sources: [] });
        expect(run.captureGenerationInputTaskSources([], [{ role: 'user', content: 'Only this instruction.' }]))
            .toEqual({ state: 'none', sources: [] });
    });

    it.each(['read_note', 'query_notes'] as const)(
        'treats an unrepresented %s material observation as unknown rather than an empty source set',
        toolName => {
            const run = fixture().create();
            const observation: PaAgentMessage = {
                role: 'toolResult',
                id: `${toolName}-result`,
                toolCallId: `${toolName}-call`,
                toolName,
                timestamp: 1,
                isError: false,
                content: {
                    promptText: 'A represented vault observation without source records.',
                    includeInNextPrompt: true,
                },
            };

            expect(run.captureGenerationInputTaskSources([observation], [])).toEqual({
                state: 'unknown',
                sources: [],
            });
        },
    );
    it('projects historical sources using current Host validity while preserving original messages', () => {
        const h = fixture();
        const fromNote = (path: string): ChatMessage => ({ role: 'assistant', content: path,
            memoryMetadata: { hasMemoryContent: false, allowedMemorySourcePaths: [], sourceRecords: [
                { kind: 'context-used', dedupKey: path, path, sourceBoundary: 'read-only-tool' },
            ] } });
        const history: ChatMessage[] = [fromNote(h.a.path), fromNote(h.b.path),
            { role: 'assistant', content: 'legacy choices' }, { role: 'user', content: 'use the second' }];
        const run = h.create();
        expect(run.projectHistory(history)).toEqual(history);
        h.files.delete(h.a.path);
        expect(run.projectHistory(history)).toEqual(history.slice(1));
        expect(history[0].content).toBe(h.a.path);
        h.files.set(h.a.path, h.a);
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

    it.each(['deleted', 'replaced'] as const)('removes %s evidence and its metadata without editing conversation history', reason => {
        const h = fixture();
        const run = h.create();
        run.resolveNoteId(h.b.path);
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
        expect(run.state.snapshot()).toMatchObject({ allowedNoteIds: null, excludedNoteIds: [] });
    });

    it('exposes linked and user-named identities without treating model text as Host admission', () => {
        const h = fixture();
        h.host.userText = '只用当前笔记和它链接的报告回答，不要查网页';
        h.host.getCurrentNoteLinks = () => [{ path: h.b.path, title: 'Sensitive alias from current note' }];
        const run = h.create();
        const directory = contextNotes(run);
        expect(directory.notes.map(note => note.path)).toEqual([h.a.path, h.b.path]);
        expect(directory.notes.find(note => note.path === h.b.path)).not.toHaveProperty('title');
        expect(run.state.allows({ kind: 'note', noteId: run.resolveNoteId(h.b.path)! })).toBe(true);
        expect(run.state.allows({ kind: 'web' })).toBe(true);
    });

    it('exposes an exact user-named path as identity data', () => {
        const h = fixture();
        h.host.userText = '只允许读取 notes/b.md 回答';
        const run = h.create();
        expect(contextNotes(run).notes.map(note => note.path)).toEqual([h.a.path, h.b.path]);
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
        const snapshot = admission(run);
        expect(snapshot).toMatchObject({ runId: 'run-1', userMessageId: 'user-1', allowedNoteIds: null });
        expect(run.state.matchesRun('run-1', userText)).toBe(true);
        expect(run.state.matchesRun('changed-run', 'new instruction')).toBe(false);
    });

    it('registers discovered Markdown and Canvas files without changing the committed authorization', () => {
        const h = fixture();
        const run = h.create();
        const snapshot = admission(run);
        const bId = run.resolveNoteId(h.b.path)!;
        const canvasId = run.resolveNoteId(h.canvas.path)!;
        expect(bId).toBeDefined();
        expect(canvasId).toBeDefined();
        expect(run.resolveNoteId(h.b.path)).toBe(bId);
        expect(contextNotes(run).notes.map(note => note.path)).toEqual([h.a.path]);
        expect(run.state.snapshot()).toBe(snapshot);
        expect(run.state.allows({ kind: 'note', noteId: bId })).toBe(true);
        expect(run.state.allows({ kind: 'note', noteId: canvasId })).toBe(true);
        expect(run.state.registerNoteHandle('note_1', bId)).toBe(false);
        expect(run.state.snapshot()).toBe(snapshot);
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
        const scope = admission(run);
        h.files.delete(originalPath);
        if (change === 'replace') h.files.set(originalPath, { path: originalPath });
        if (change === 'rename') {
            h.a.path = 'notes/renamed.md';
            h.files.set(h.a.path, h.a);
            expect(run.resolveNoteId(h.a.path)).toBeUndefined();
        }
        expect(run.resolveNoteId(originalPath)).toBeUndefined();
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
    });

    it('keeps a fixed vault search admission and rejects copied or foreign snapshots', () => {
        const h = fixture();
        const run = h.create();
        const scope = admission(run);
        expect(run.resolveNoteSearchScope(scope)).toEqual({ allowedPaths: null, excludedPaths: [] });
        expect(() => run.resolveNoteSearchScope({ ...scope })).toThrow();
        expect(() => run.resolveNoteSearchScope(admission(h.create()))).toThrow();
        expect(Object.isFrozen(run.resolveNoteSearchScope(scope))).toBe(true);
    });

    it('rejects a revoked run before identity reads and handles a failing lifecycle check', () => {
        const h = fixture();
        const run = h.create();
        const scope = admission(run);
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
        expect(run.state.snapshot()).toMatchObject({ allowedNoteIds: null });
    });

    it.each(['unknown_tool', 'load_tool_capability', 'read_image', 'present_writing'])
    ('rejects the complete batch for unplanned %s instead of assigning no reads', name => {
        const run = fixture().create();
        expect(run.resolveReadPlans([call('current', 'get_current_note_context'), call('extra', name)])).toBeUndefined();
        expect(run.state.snapshot()).toMatchObject({ allowedNoteIds: null });
    });

    it('passes one live Host read guard to a current-note and Memory batch', () => {
        const h = fixture();
        const run = h.create();
        const executor = executorFor(run);
        const result = executor.preflight([
            call('current', 'get_current_note_context'), call('memory', 'search_memory', 'query'),
        ]);
        if (!result || !('kind' in result)) throw new Error('Expected source admission');
        const guard = result.taskSourceReadGuard;
        if (!guard) throw new Error('Expected source guard');
        expect(guard.getNoteSearchScope!()).toEqual({ allowedPaths: null, excludedPaths: [] });
        expect(guard.isPathAllowed(h.a.path)).toBe(true);
        expect(guard.isPathAllowed(h.b.path)).toBe(true);
        h.files.set(h.a.path, { path: h.a.path });
        expect(guard.isPathAllowed(h.a.path)).toBe(false);
        expect(executor.execute).not.toHaveBeenCalled();
        expect(executor.prepareBatch).not.toHaveBeenCalled();
    });

    it('does not turn thousands of internal vault guard registrations into a public directory', () => {
        const h = fixture();
        const run = h.create();
        const scope = admission(run);
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

    it('publishes only live Host-confirmed identities and removes a deleted source', () => {
        const h = fixture();
        const run = h.create();
        const scope = admission(run);
        expect(run.publishAdmittedNotePaths([h.b.path, h.canvas.path], { ...scope })).toBe(false);
        expect(run.publishAdmittedNotePaths([h.b.path, h.canvas.path], scope)).toBe(true);
        expect(contextNotes(run).notes.map(note => note.path)).toEqual([h.a.path, h.canvas.path, h.b.path]);
        h.files.delete(h.b.path);
        expect(contextNotes(run).notes.map(note => note.path)).toEqual([h.a.path, h.canvas.path]);
        expect(run.publishAdmittedNotePaths([h.b.path], scope)).toBe(false);
    });

    it('keeps the current note and the exact published projection within the handle limit', () => {
        const h = fixture();
        const run = h.create();
        const scope = admission(run);
        const paths = Array.from({ length: MAX_TASK_SOURCE_NOTE_HANDLES + 20 }, (_, index) => `notes/visible-${index}.md`);
        for (const path of paths) h.files.set(path, { path });
        const firstId = run.resolveNoteId(paths[0]);
        expect(run.publishAdmittedNotePaths(paths, scope)).toBe(true);
        let visiblePaths = contextNotes(run).notes.map(note => note.path);
        expect(visiblePaths).toEqual([h.a.path, ...paths.slice(21).reverse()]);
        expect(run.resolveNoteId(paths[0])).toBe(firstId);
        expect(contextNotes(run).notes.map(note => note.path)).toEqual(visiblePaths);
        expect(run.publishAdmittedNotePaths([paths[0]], scope)).toBe(true);
        visiblePaths = contextNotes(run).notes.map(note => note.path);
        expect(visiblePaths).toHaveLength(2);
        expect(visiblePaths.slice(0, 2)).toEqual([h.a.path, paths[0]]);
        expect(run.state.snapshot()).toBe(scope);
    });

    it('budgets escaped directory characters using whole paths, while keeping the newest visible sources', () => {
        const h = fixture();
        const run = h.create();
        const scope = admission(run);
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
        const scope = admission(run);
        expect(run.publishAdmittedNotePaths([h.b.path], scope)).toBe(true);
        const encoded = run.contextInstruction().split('\n').slice(-1)[0];
        expect(encoded.length).toBeLessThanOrEqual(MAX_TASK_SOURCE_NOTE_DIRECTORY_CHARS);
        expect(contextNotes(run)).toEqual({ currentNoteHandle: 'note_1', notes: [{ handle: 'note_2', path: h.b.path }] });
        expect(run.resolveNoteId(h.a.path)).toBe('run-1:note:1');
    });

    it('does not partially publish a group when a later source identity cannot be verified', () => {
        const h = fixture();
        const run = h.create();
        const scope = admission(run);
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
        expect(instruction).toContain('Data Boundary');
        expect(instruction).not.toContain(h.host.userText);
    });
});
