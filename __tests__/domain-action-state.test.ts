import { cloneActionStates, collectActionStates, projectActionStates, projectActionSummaryFacts, refreshGhostActionState, refreshImageActionState, refreshWritingSaveState, refreshWritingSaveStates,
    type PaAgentActionState } from '../src/ai-services/pa-agent-result-facts';
import { completeInputLineage } from '../src/ai-services/input-lineage';
import type { ImageGenerationTask } from '../src/chat/image-generation-types';
import type { SaveReceipt } from '../src/chat/save-receipt-types';
import { historySummaryContent } from '../src/ai-services/context/PaAgentHistoryContextPlan';
import { buildPaAgentDeterministicActionSummary } from '../src/ai-services/context/PaAgentContextSummarizer';
import { isCurrentHistorySummary, projectPaAgentRetainedActionFacts } from '../src/ai-services/context/PaAgentContextSummaryTypes';
import { applyOperationsExecutionResult, applyOperationsUndoResult } from '../src/ai-services/pa-agent-result-facts';
import { OperationsIntentController } from '../src/ai-services/operations/operations-intent-controller';
import { createPrepareGhostPostTool, type ChatToolContext } from '../src/ai-services/chat-tools';
import { chatToolResultToPaAgentToolExecutionResult } from '../src/ai-services/pa-agent-host-tools';
import type { PaAgentMessage } from '../src/ai-services/chat-types';

async function ghostAttentionTranscript(operationId: string | null = 'attention-operation') {
    const tool = createPrepareGhostPostTool({ conversationId: 'conversation', stableMessageId: 'user',
        submit: async () => ({ status: 'needs_attention', ...(operationId ? { operationId } : {}) }) });
    const call = { type: 'toolCall' as const, id: 'ghost-call', index: 0, name: 'prepare_ghost_post', input: { intent: 'prepare' as const } };
    const result = await tool.execute(call.input, { host: { log: () => undefined },
        taskSourceReadGuard: { isCurrent: () => true, isNoteDomainAllowed: () => true, isPathAllowed: () => true } } as unknown as ChatToolContext);
    const execution = chatToolResultToPaAgentToolExecutionResult(call, result);
    const messages: PaAgentMessage[] = [
        { role: 'assistant', id: 'assistant', timestamp: 1, content: [call] },
        { role: 'toolResult', id: 'ghost-result', toolCallId: call.id, toolName: call.name,
            timestamp: 2, isError: !result.ok,
            inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user' }, { kind: 'vault', path: 'Note.md', via: 'note' }]),
            content: { promptText: execution.promptText, previewText: execution.previewText, includeInNextPrompt: true,
                sourceRecords: execution.sourceRecords, contextUsed: execution.contextUsed,
                resultFact: execution.resultFact, metadata: execution.metadata } },
    ];
    return messages;
}

function state(owner: PaAgentActionState['owner'], operationId: string, receipt: PaAgentActionState['receipt'], phase: PaAgentActionState['phase']): PaAgentActionState {
    return { schemaVersion: 1, owner, operationId, receipt, phase, revision: 0,
        origin: { runId: 'run', turnId: 'turn', assistantId: 'assistant', callId: 'call', resultId: 'result' },
        inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user' }]) };
}

it('projects unconfirmed image submission only from a matching owner task receipt', () => {
    const unknown = { ...state('image', 'task', { kind: 'image-task', taskId: 'task',
        taskRevision: 2, state: 'submission_unknown' }, 'unknown'), revision: 1 };
    expect(projectActionStates([unknown])).toEqual([expect.objectContaining({ phase: 'unknown',
        effectOutcome: 'unknown', sideEffectsMayHaveOccurred: true, imageProviderAcceptanceStatus: 'unknown' })]);
    expect(projectActionSummaryFacts([unknown])).toEqual([expect.objectContaining({ imageProviderAcceptanceStatus: 'unknown' })]);
    expect(projectPaAgentRetainedActionFacts([{ role: 'assistant', content: 'Earlier accepted claim', actionStates: [unknown] }]))
        .toEqual([expect.objectContaining({ index: 1, actionStates: [expect.objectContaining({ imageProviderAcceptanceStatus: 'unknown' })] })]);
    expect(historySummaryContent({ role: 'assistant', content: 'Earlier accepted claim', actionStates: [unknown] }))
        .toBe('Earlier accepted claim');
    const source = { role: 'assistant' as const, content: 'Earlier accepted claim', actionStates: [unknown] };
    const anchor = buildPaAgentDeterministicActionSummary(projectPaAgentRetainedActionFacts([source]), [source]);
    expect(anchor.open_questions).toHaveLength(1);
    expect(anchor.open_questions[0]).toMatchObject({ sourceMessages: [1] });
    expect(anchor.open_questions[0].text).toContain('imageProviderAcceptanceStatus=unknown');
    expect(anchor.open_questions[0].text).toContain('effectOutcome=unknown');
    expect(anchor.open_questions[0].text).toContain('sideEffectsMayHaveOccurred=true');
    expect(JSON.stringify(projectActionStates([unknown]))).not.toContain('receipt');
    for (const invalid of [
        { ...unknown, owner: 'ghost' }, { ...unknown, phase: 'accepted' },
        { ...unknown, receipt: { ...unknown.receipt, taskId: 'foreign' } },
    ]) expect(projectActionStates([invalid as PaAgentActionState])).toEqual([]);
    for (const phase of ['running', 'completed', 'failed'] as const) {
        const other = { ...unknown, phase, receipt: { kind: 'image-task' as const, taskId: 'task', taskRevision: 3, state: phase } };
        expect(JSON.stringify(projectActionStates([other]))).not.toContain('imageProviderAcceptanceStatus');
    }
    const legacy = { ...state('ghost', 'ghost-op', { kind: 'ghost-operation', operationId: 'ghost-op',
        operationRevision: 2, state: 'outcome_unknown', verified: false }, 'unknown'), revision: 1 };
    expect(projectActionStates([legacy])).toEqual([expect.objectContaining({ phase: 'unknown' })]);
    expect(JSON.stringify(projectActionStates([legacy]))).not.toContain('imageProviderAcceptanceStatus');
});

describe('closed action summary facts', () => {
    it('retains revision-zero acceptance and pending facts without authority or owner internals', () => {
        const states = [
            state('image', 'image-task', { kind: 'image-accepted', taskId: 'image-task' }, 'accepted'),
            state('operations', 'intent', { kind: 'operations-staged', intentId: 'intent' }, 'pending'),
            state('writing', 'version', { kind: 'writing-version', versionId: 'version' }, 'ready'),
            state('ghost', 'ghost-op', { kind: 'ghost-preparation', operationId: 'ghost-op', status: 'prepared' }, 'prepared'),
        ];
        expect(projectActionSummaryFacts(states)).toEqual([
            { owner: 'image', operationId: 'image-task', phase: 'accepted' },
            { owner: 'operations', operationId: 'intent', phase: 'pending' },
            { owner: 'writing', operationId: 'version', phase: 'ready' },
            { owner: 'ghost', operationId: 'ghost-op', phase: 'prepared' },
        ]);
    });

    it('retains proven Image and Ghost effects and omits only completed all-applied Operations substeps', () => {
        const image = refreshImageActionState(state('image', 'task', { kind: 'image-accepted', taskId: 'task' }, 'accepted'),
            { taskId: 'task', conversationId: 'conversation', stableMessageId: 'user', state: 'completed', revision: 4 } as ImageGenerationTask,
            'conversation', 'user')!;
        const ghost = refreshGhostActionState(state('ghost', 'ghost-op',
            { kind: 'ghost-preparation', operationId: 'ghost-op', status: 'prepared' }, 'prepared'),
            { operationId: 'ghost-op', revision: 2, state: 'terminal', verified: true })!;
        const operations = { ...state('operations', 'intent', { kind: 'operations-result', intentId: 'intent', state: 'completed' }, 'completed'),
            revision: 1, actions: [{ actionId: 'operation-a', phase: 'applied' as const, receiptId: 'receipt-a' },
                { actionId: 'operation-b', phase: 'applied' as const, receiptId: 'receipt-b' }] };
        expect(projectActionSummaryFacts([image, ghost, operations])).toEqual([
            { owner: 'image', operationId: 'task', phase: 'completed', imageOutputStatus: 'saved' },
            { owner: 'ghost', operationId: 'ghost-op', phase: 'completed', ghostPublicationStatus: 'published' },
            { owner: 'operations', operationId: 'intent', phase: 'completed', operationsEffectStatus: 'applied' },
        ]);
        expect(projectActionStates([operations])).toEqual([expect.objectContaining({ actions: operations.actions })]);
    });

    it('preserves each incomplete and undone Operations substep without claiming the whole intent was applied', () => {
        const partial = { ...state('operations', 'partial', { kind: 'operations-result', intentId: 'partial', state: 'partial' }, 'partial'),
            revision: 1, actions: [{ actionId: 'applied', phase: 'applied' as const, receiptId: 'receipt-applied' },
                { actionId: 'failed', phase: 'failed' as const }, { actionId: 'skipped', phase: 'skipped' as const }] };
        const failed = { ...state('operations', 'failed', { kind: 'operations-result', intentId: 'failed', state: 'failed' }, 'failed'),
            revision: 1, actions: [{ actionId: 'failed-a', phase: 'failed' as const, receiptId: 'receipt-failed' }] };
        const undone = { ...state('operations', 'undone', { kind: 'operations-undo', intentId: 'undone' }, 'undone'),
            revision: 2, actions: [{ actionId: 'undone-a', phase: 'undone' as const, receiptId: 'receipt-undone' }] };
        const partialUndo = { ...state('operations', 'partial-undo', { kind: 'operations-undo', intentId: 'partial-undo' }, 'partial'),
            revision: 2, actions: [{ actionId: 'undone-b', phase: 'undone' as const, receiptId: 'receipt-undone-b' },
                { actionId: 'unknown', phase: 'unknown' as const }] };
        const states = [partial, failed, undone, partialUndo];
        expect(projectActionSummaryFacts(states)).toEqual(states.map(item => ({
            owner: 'operations', operationId: item.operationId, phase: item.phase, actions: item.actions,
        })));
    });

    it('preserves independent Writing saves and note substeps without private paths, hashes or receipt objects', () => {
        const ready = state('writing', 'version', { kind: 'writing-version', versionId: 'version' }, 'ready');
        const receipt: SaveReceipt = { id: 'save-a', operationId: 'save-a', writingVersionId: 'version', textHash: 'a'.repeat(64),
            targetNotePath: 'private/path.md', origin: 'ai_generated', createdAt: 1, attachments: [],
            initialNoteHash: 'b'.repeat(64), noteContentHash: 'c'.repeat(64), noteState: 'created', state: 'partial' };
        const single = refreshWritingSaveState(ready, receipt)!;
        expect(projectActionSummaryFacts([single])).toEqual([{ owner: 'writing', operationId: 'version', phase: 'partial',
            saves: [{ saveId: 'save-a', state: 'partial', noteState: 'created' }] }]);
        const multiple = refreshWritingSaveStates(ready, [receipt,
            { ...receipt, id: 'save-b', state: 'completed', noteState: 'completed', finalNoteHash: receipt.noteContentHash },
            { ...receipt, id: 'save-c', state: 'failed', noteState: 'pending' }])!;
        expect(projectActionSummaryFacts([multiple])).toEqual([{ owner: 'writing', operationId: 'version', phase: 'partial', saves: [
            { saveId: 'save-a', state: 'partial', noteState: 'created' },
            { saveId: 'save-b', state: 'completed', noteState: 'completed' },
            { saveId: 'save-c', state: 'failed', noteState: 'pending' },
        ] }]);
        const legacy = { ...state('writing', 'legacy',
            { kind: 'writing-save', versionId: 'legacy', saveId: 'legacy-save', state: 'partial' }, 'partial'), revision: 1 };
        expect(projectActionSummaryFacts([legacy])).toEqual([{ owner: 'writing', operationId: 'legacy', phase: 'partial',
            saves: [{ saveId: 'legacy-save', state: 'partial' }] }]);
    });

    it('keeps unknown effects unresolved and rejects forged completion instead of upgrading tool success', () => {
        const unknown = state('ghost', 'unknown', { kind: 'ghost-preparation', operationId: 'unknown', status: 'outcome_unknown' }, 'unknown');
        const lost = { ...state('operations', 'lost', { kind: 'operations-terminal', intentId: 'lost', state: 'lost' }, 'lost'), revision: 1 };
        const unavailable = { ...state('ghost', 'unavailable',
            { kind: 'ghost-unavailable', operationId: 'unavailable', reason: 'status_read_unavailable' }, 'unavailable'), revision: 1 };
        expect(projectActionSummaryFacts([unknown, lost, unavailable])).toEqual([unknown, lost, unavailable].map(item => ({
            owner: item.owner, operationId: item.operationId, phase: item.phase,
            effectOutcome: 'unknown', sideEffectsMayHaveOccurred: true,
        })));
        expect(projectActionSummaryFacts([{ ...unknown, phase: 'completed' }])).toEqual([]);
        const pending = state('operations', 'intent', { kind: 'operations-staged', intentId: 'intent' }, 'pending');
        expect(projectActionSummaryFacts([{ ...pending, toolOutcome: 'success' } as PaAgentActionState])).toEqual([]);
    });
});

describe('domain receipt lifecycle projection', () => {
    it('retains only the matched Host operation identity from an attention-required Ghost result', async () => {
        const messages = await ghostAttentionTranscript(), input = { runId: 'run', turnId: 'turn', messages };
        const states = collectActionStates(input);
        expect(states).toEqual([expect.objectContaining({ owner: 'ghost', operationId: 'attention-operation', phase: 'unknown', revision: 0,
            origin: { runId: 'run', turnId: 'turn', assistantId: 'assistant', callId: 'ghost-call', resultId: 'ghost-result' },
            receipt: { kind: 'ghost-preparation', operationId: 'attention-operation', status: 'needs_attention' } })]);
        expect(cloneActionStates(states)).toEqual(states);
        expect(projectActionStates(states)).toEqual([expect.objectContaining({ phase: 'unknown', effectOutcome: 'unknown',
            sideEffectsMayHaveOccurred: true, contextOnly: true })]);
        expect(JSON.stringify(projectActionStates(states))).not.toContain('ghostPublicationStatus');
        for (const phase of ['prepared', 'completed'] as const) expect(cloneActionStates([{ ...states[0], phase }])).toEqual([]);
        expect(collectActionStates({ ...input, messages: await ghostAttentionTranscript(null) })).toEqual([]);
    });

    it.each(['fact-id', 'body-id', 'call-id', 'lineage', 'metadata', 'legacy-unavailable', 'body-message'] as const)(
        'rejects attention-required Ghost state when its %s proof differs', async mismatch => {
            const messages = await ghostAttentionTranscript(), result = messages[1] as Extract<PaAgentMessage, { role: 'toolResult' }>;
            if (mismatch === 'fact-id') result.content.resultFact = { kind: 'unknown', operationId: 'another-operation' };
            else if (mismatch === 'call-id') result.toolCallId = 'another-call';
            else if (mismatch === 'lineage') delete result.inputLineage;
            else if (mismatch === 'metadata') result.content.metadata!.ok = false;
            else if (mismatch === 'legacy-unavailable') result.content.resultFact = { kind: 'unavailable', capability: 'prepare_ghost_post', reason: 'ghost_attention_required' };
            else {
                const envelope = JSON.parse(result.content.promptText);
                if (mismatch === 'body-id') envelope.observation.operationId = 'another-operation';
                else envelope.observation.message = 'It is published.';
                result.content.promptText = JSON.stringify(envelope);
            }
            expect(collectActionStates({ runId: 'run', turnId: 'turn', messages })).toEqual([]);
        },
    );
    it('projects applied effects only from the real controller execution receipt', async () => {
        const files = new Map<string, string>();
        let id = 0;
        const controller = new OperationsIntentController({ createId: () => `operation-${++id}`,
            vault: { adapter: { exists: async path => files.has(path), read: async path => files.get(path)! },
                cachedRead: async file => files.get(file.path)!,
                getAbstractFileByPath: path => files.has(path) ? { path, extension: 'md' } : null,
                create: async (path, content) => { files.set(path, content); return { path }; },
                process: async (file, transform) => { const next = transform(files.get(file.path)!); files.set(file.path, next); return next; } },
            trashFile: async file => { files.delete(file.path); } });
        const intent = await controller.stageIntent({ runId: 'run', turnId: 'turn', operations: [
            { toolCallId: 'call', name: 'vault_create', input: { path: 'effect.md', content: 'PRIVATE_BODY' } } ] });
        const pending = state('operations', intent.id, { kind: 'operations-staged', intentId: intent.id }, 'pending');
        expect(JSON.stringify(projectActionStates([pending]))).not.toContain('operationsEffectStatus');
        const completed = applyOperationsExecutionResult(pending, await controller.executeIntent(intent.id))!;
        expect(files.get('effect.md')).toBe('PRIVATE_BODY');
        expect(projectActionStates([completed])).toEqual([expect.objectContaining({ operationsEffectStatus: 'applied', actions: completed.actions })]);
        expect(JSON.stringify(projectPaAgentRetainedActionFacts([{ role: 'assistant', content: 'Preview awaits confirmation.', actionStates: [completed] }])))
            .toContain('"operationsEffectStatus":"applied"');
        expect(historySummaryContent({ role: 'assistant', content: 'Preview awaits confirmation.', actionStates: [completed] }))
            .toBe('Preview awaits confirmation.');
        expect(JSON.stringify(projectActionStates([completed]))).not.toMatch(/PRIVATE_BODY|effect\.md|operations-result/);
        const undone = applyOperationsUndoResult(completed, await controller.undo(completed.actions![0].receiptId!))!;
        const partial = { ...completed, phase: 'partial', receipt: { kind: 'operations-result', intentId: intent.id, state: 'partial' },
            actions: [...completed.actions!, { actionId: 'failed-action', phase: 'failed' }] };
        const unknown = { ...completed, phase: 'unknown', actions: undefined, receipt: { kind: 'operations-terminal', intentId: intent.id, state: 'unknown' } };
        for (const candidate of [undone, partial, unknown, { ...completed, receipt: undefined },
            { ...completed, phase: 'lost', actions: undefined, receipt: { kind: 'operations-terminal', intentId: intent.id, state: 'lost' } },
            { ...completed, actions: undefined }, { ...completed, actions: [] },
            { ...completed, actions: [{ actionId: 'unproved', phase: 'applied' }] }]) {
            expect(JSON.stringify(projectActionStates([candidate as PaAgentActionState]))).not.toContain('operationsEffectStatus');
            expect(JSON.stringify(projectPaAgentRetainedActionFacts([{ role: 'assistant', content: 'Write succeeded.', actionStates: [candidate as PaAgentActionState] }])))
                .not.toContain('operationsEffectStatus');
        }
        controller.dispose();
    });
    it('describes unresolved effects as possible rather than falsely deciding rejection or completion', () => {
        const prepared = state('ghost', 'op', { kind: 'ghost-preparation', operationId: 'op', status: 'prepared' }, 'prepared');
        const unknown = refreshGhostActionState(prepared, { operationId: 'op', revision: 1, state: 'outcome_unknown', verified: false })!;
        expect(projectActionStates([unknown])).toEqual([expect.objectContaining({ phase: 'unknown', effectOutcome: 'unknown', sideEffectsMayHaveOccurred: true })]);
        expect(JSON.stringify(projectActionStates([prepared]))).not.toContain('sideEffectsMayHaveOccurred');
        expect(JSON.stringify(projectActionStates([unknown]))).not.toContain('ghostPublicationStatus');
    });
    it('exposes saved Image outputs without internal revision while keeping revision-only cache invalidation', () => {
        const accepted = state('image', 'task', { kind: 'image-accepted', taskId: 'task' }, 'accepted');
        const completed = refreshImageActionState(accepted, { taskId: 'task', conversationId: 'conversation',
            stableMessageId: 'user', state: 'completed', revision: 4 } as ImageGenerationTask, 'conversation', 'user')!;
        const projected = projectActionStates([completed]);
        expect(projected).toEqual([expect.objectContaining({ imageOutputStatus: 'saved' })]);
        expect(JSON.stringify(projected)).not.toContain('revision');
        expect(JSON.stringify(projectPaAgentRetainedActionFacts([{ role: 'assistant', content: 'Generated', actionStates: [completed] }]))).toContain('"imageOutputStatus":"saved"');
        expect(historySummaryContent({ role: 'assistant', content: 'Generated', actionStates: [completed] })).toBe('Generated');
        expect(cloneActionStates([completed])[0]).toMatchObject({ revision: 1, receipt: { taskRevision: 4 } });
        const source = { role: 'assistant' as const, content: 'Generated', actionStates: [completed] };
        expect(isCurrentHistorySummary({ text: 'summary', sourceMessages: [source] }, [source])).toBe(true);
        expect(isCurrentHistorySummary({ text: 'summary', sourceMessages: [source] },
            [{ ...source, actionStates: [{ ...completed, revision: completed.revision + 1 }] }])).toBe(false);
        for (const phase of ['prepared', 'running', 'saving', 'partial', 'submission_unknown'] as const) {
            const other = refreshImageActionState(accepted, { taskId: 'task', conversationId: 'conversation',
                stableMessageId: 'user', state: phase, revision: 4 } as ImageGenerationTask, 'conversation', 'user')!;
            expect(JSON.stringify(projectActionStates([other]))).not.toContain('imageOutputStatus');
        }
    });

    it('retains the real created Writing note step through closed receipts and summary projection', () => {
        const ready = state('writing', 'version', { kind: 'writing-version', versionId: 'version' }, 'ready');
        const receipt: SaveReceipt = { id: 'save', operationId: 'save', writingVersionId: 'version', textHash: 'a'.repeat(64),
            targetNotePath: 'private/path.md', origin: 'ai_generated', createdAt: 1, attachments: [],
            initialNoteHash: 'b'.repeat(64), noteContentHash: 'c'.repeat(64), noteState: 'created', state: 'partial' };
        const partial = refreshWritingSaveStates(ready, [receipt])!;
        expect(cloneActionStates([partial])[0].receipt).toEqual({ kind: 'writing-saves', versionId: 'version',
            saves: [{ saveId: 'save', state: 'partial', noteState: 'created' }] });
        const projected = projectActionStates([partial]);
        expect(projected).toEqual([expect.objectContaining({ saves: [{ saveId: 'save', state: 'partial', noteState: 'created' }] })]);
        const summary = JSON.stringify(projectPaAgentRetainedActionFacts([{ role: 'assistant', content: 'Saving', actionStates: [partial] }]));
        expect(summary).toContain('"noteState":"created"');
        expect(historySummaryContent({ role: 'assistant', content: 'Saving', actionStates: [partial] })).toBe('Saving');
        expect(summary).not.toContain('private/path');
        expect(summary).not.toContain(receipt.textHash);
        expect(refreshWritingSaveStates(partial, [{ ...receipt, noteState: 'pending' }])).toEqual(partial);
        const single = refreshWritingSaveState(ready, receipt)!;
        expect(projectActionStates([single])).toEqual([expect.objectContaining({ saves: [{ saveId: 'save', state: 'partial', noteState: 'created' }] })]);
        expect(refreshWritingSaveState(single, { ...receipt, noteState: 'pending' })).toEqual(single);
        expect(refreshWritingSaveStates(single, [{ ...receipt, noteState: 'pending' }])).toEqual(single);
        expect(refreshWritingSaveState(ready, { ...receipt, state: 'completed', noteState: 'completed',
            finalNoteHash: undefined })).toBeUndefined();
    });

    it('keeps legacy Writing substeps unproven and rejects contradictory or unbounded new fields', () => {
        const legacy = { ...state('writing', 'version', { kind: 'writing-save', versionId: 'version', saveId: 'save', state: 'partial' }, 'partial'), revision: 1 };
        expect(cloneActionStates([legacy])).toEqual([legacy]);
        expect(JSON.stringify(projectActionStates([legacy]))).not.toContain('noteState');
        const legacyMultiple = { ...legacy, receipt: { kind: 'writing-saves' as const, versionId: 'version',
            saves: [{ saveId: 'save', state: 'partial' as const }] } };
        expect(cloneActionStates([legacyMultiple])).toEqual([legacyMultiple]);
        expect(JSON.stringify(projectPaAgentRetainedActionFacts([{ role: 'assistant', content: 'Saving', actionStates: [legacyMultiple] }]))).not.toContain('noteState');
        for (const receipt of [
            { kind: 'writing-save', versionId: 'version', saveId: 'save', state: 'completed', noteState: 'created' },
            { kind: 'writing-save', versionId: 'version', saveId: 'save', state: 'prepared', noteState: 'created' },
            { kind: 'writing-save', versionId: 'version', saveId: 'save', state: 'partial', noteState: 'published' },
            { kind: 'writing-save', versionId: 'version', saveId: 'save', state: 'partial', noteState: 'created', path: 'private.md' },
        ]) expect(cloneActionStates([{ ...legacy, phase: receipt.state, receipt }])).toEqual([]);
    });
    it('preserves verified Ghost publication in direct and summary projection without raw owner data', () => {
        for (const ownerState of ['terminal', 'cleanup_pending'] as const) {
            const prepared = state('ghost', 'ghost-op', { kind: 'ghost-preparation', operationId: 'ghost-op', status: 'prepared' }, 'prepared');
            const completed = refreshGhostActionState(prepared, { operationId: 'ghost-op', revision: 2,
                state: ownerState, verified: true })!;
            const projected = projectActionStates([completed]);
            expect(projected).toEqual([expect.objectContaining({ ghostPublicationStatus: 'published',
                contextOnly: true })]);
            expect(JSON.stringify(projected)).not.toContain('grantsWriteAuthority');
            const summary = JSON.stringify(projectPaAgentRetainedActionFacts([{ role: 'assistant', content: 'Earlier preparation remains unpublished.', actionStates: [completed] }]));
            expect(summary).toContain('"ghostPublicationStatus":"published"');
            expect(historySummaryContent({ role: 'assistant', content: 'Earlier preparation remains unpublished.', actionStates: [completed] }))
                .toBe('Earlier preparation remains unpublished.');
            expect(JSON.stringify(projected)).not.toContain('receipt');
            expect(summary).not.toContain('ghost-operation');
        }
    });

    it('reads an image completion only for its original request and ignores late lower revisions', () => {
        const accepted = state('image', 'task', { kind: 'image-accepted', taskId: 'task' }, 'accepted');
        const task = { taskId: 'task', conversationId: 'conversation', stableMessageId: 'user', state: 'completed', revision: 4 } as ImageGenerationTask;
        expect(refreshImageActionState(accepted, task, 'other', 'user')).toBeUndefined();
        const completed = refreshImageActionState(accepted, task, 'conversation', 'user')!;
        expect(completed.phase).toBe('completed');
        expect(refreshImageActionState(completed, { ...task, state: 'running', revision: 3 }, 'conversation', 'user')).toEqual(completed);
        expect(cloneActionStates([{ ...completed, phase: 'failed' }])).toEqual([]);
    });

    it('keeps Ghost preparation and unverified terminal results distinct from verified publication', () => {
        const prepared = state('ghost', 'ghost-op', { kind: 'ghost-preparation', operationId: 'ghost-op', status: 'prepared' }, 'prepared');
        const unknown = refreshGhostActionState(prepared, { operationId: 'ghost-op', revision: 2, state: 'terminal', verified: false })!;
        expect(unknown.phase).toBe('unknown');
        for (const candidate of [prepared, unknown, { ...unknown, phase: 'completed' as const }]) {
            expect(JSON.stringify(projectActionStates([candidate]))).not.toContain('ghostPublicationStatus');
            expect(JSON.stringify(projectPaAgentRetainedActionFacts([{ role: 'assistant', content: 'Preparation', actionStates: [candidate] }])))
                .not.toContain('ghostPublicationStatus');
        }
        const completed = refreshGhostActionState(unknown, { operationId: 'ghost-op', revision: 3, state: 'terminal', verified: true })!;
        expect(completed.phase).toBe('completed');
        expect(refreshGhostActionState(completed, { operationId: 'ghost-op', revision: 2, state: 'prepared', verified: false })).toEqual(completed);
        expect(cloneActionStates([{ ...unknown, phase: 'completed' }])).toEqual([]);
    });

    it('represents multiple Writing saves independently and rejects incomplete completion proof', () => {
        const ready = state('writing', 'version', { kind: 'writing-version', versionId: 'version' }, 'ready');
        const receipt: SaveReceipt = { id: 'save-a', operationId: 'save-a', writingVersionId: 'version', textHash: 'a'.repeat(64),
            targetNotePath: 'a.md', origin: 'ai_generated', createdAt: 1, attachments: [], initialNoteHash: 'b'.repeat(64),
            noteContentHash: 'c'.repeat(64), finalNoteHash: 'c'.repeat(64), noteState: 'completed', state: 'completed' };
        const partial = refreshWritingSaveStates(ready, [receipt, { ...receipt, id: 'save-b', state: 'failed', noteState: 'pending' }])!;
        expect(partial.phase).toBe('partial');
        expect(partial.receipt.kind === 'writing-saves' && partial.receipt.saves).toEqual([
            { saveId: 'save-a', state: 'completed', noteState: 'completed' }, { saveId: 'save-b', state: 'failed', noteState: 'pending' },
        ]);
        expect(refreshWritingSaveStates(ready, [{ ...receipt, finalNoteHash: undefined }])).toBeUndefined();
        expect(refreshWritingSaveStates(ready, [{ ...receipt, writingVersionId: 'other' }])).toBeUndefined();
    });
});
