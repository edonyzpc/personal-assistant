import { applyOperationsExecutionResult, applyOperationsUndoResult, cloneActionStates,
    collectActionStates, type PaAgentActionState } from '../src/ai-services/pa-agent-result-facts';
import { OPERATIONS_STAGED_MESSAGE } from '../src/ai-services/operations/operations-tool-provider';
import type { PaAgentMessage } from '../src/ai-services/chat-types';
import { completeInputLineage, unknownInputLineage } from '../src/ai-services/input-lineage';

const pending = (): PaAgentActionState => ({ schemaVersion: 1, owner: 'operations',
    operationId: 'intent-1', phase: 'pending', revision: 0,
    origin: { runId: 'run-1', turnId: 'turn-1', assistantId: 'assistant-1', callId: 'call-1', resultId: 'result-1' },
    inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user-1' }]),
    receipt: { kind: 'operations-staged', intentId: 'intent-1' } });

describe('Operations finite action state', () => {
    it('uses a matching owner receipt to recover lost observations, but not cancellation or expiration', () => {
        const original = pending();
        const lost: PaAgentActionState = { ...original, phase: 'lost', revision: 4,
            receipt: { kind: 'operations-terminal', intentId: original.operationId, state: 'lost' } };
        const result = { intentId: 'intent-1', state: 'completed' as const, operations: [{ operationId: 'op-1',
            status: 'succeeded' as const, receiptId: 'receipt-1', path: 'a.md', name: 'vault_create' as const, toolCallId: 'call-1' }] };
        expect(applyOperationsExecutionResult(lost, result)).toMatchObject({ phase: 'completed', revision: 5,
            origin: original.origin, inputLineage: original.inputLineage });
        for (const phase of ['cancelled', 'expired'] as const) {
            expect(applyOperationsExecutionResult({ ...lost, phase,
                receipt: { kind: 'operations-terminal', intentId: original.operationId, state: phase } }, result)).toBeUndefined();
        }
        expect(applyOperationsExecutionResult(lost, { ...result, intentId: 'other' })).toBeUndefined();
        expect(applyOperationsExecutionResult(lost, { ...result,
            operations: [{ ...result.operations[0], toolCallId: 'other-call' }] })).toBeUndefined();
        const unresolved = { ...lost, inputLineage: unknownInputLineage(original.inputLineage.dependencies) };
        expect(applyOperationsExecutionResult(unresolved, result)?.inputLineage).toEqual(unresolved.inputLineage);
    });
    it('rejects contaminated or altered staged owner receipts before collecting state', () => {
        const result: Extract<PaAgentMessage, { role: 'toolResult' }> = { role: 'toolResult', id: 'result', toolCallId: 'call', toolName: 'vault_append', isError: false, timestamp: 1,
            inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user' }]), content: {
                promptText: OPERATIONS_STAGED_MESSAGE, previewText: 'Staged vault_append for inline review; no write occurred.', includeInNextPrompt: true,
                resultFact: { kind: 'approval_pending', intentId: 'intent' }, metadata: { outcome: 'success', intentId: 'intent', operationCount: 1,
                    staged: true, wrote: false, originalLength: OPERATIONS_STAGED_MESSAGE.length, observationChars: OPERATIONS_STAGED_MESSAGE.length } } };
        const collect = (message: typeof result) => collectActionStates({ runId: 'run', turnId: 'turn', messages: [
            { role: 'assistant', id: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'call', name: 'vault_append', input: {} }] }, message] });
        expect(collect(result)).toHaveLength(1);
        expect(collect({ ...result, content: { ...result.content,
            metadata: { ...result.content.metadata, retrySafety: 'side_effect' } } })).toHaveLength(1);
        const variants = [
            { ...result, content: { ...result.content, includeInNextPrompt: false } },
            { ...result, content: { ...result.content, previewText: 'raw note text' } },
            { ...result, content: { ...result.content, contextUsed: [{ raw: 'source text' }] } },
            { ...result, content: { ...result.content, sourceRecords: [{ kind: 'memory-reference', dedupKey: 'raw', path: 'private.md' }] } },
            { ...result, content: { ...result.content, metadata: { ...result.content.metadata, operationCount: 1.5 } } },
            { ...result, content: { ...result.content, metadata: { ...result.content.metadata, raw: 'note body' } } },
            { ...result, content: { ...result.content, metadata: { ...result.content.metadata, retrySafety: 'safe' } } },
            { ...result, content: { ...result.content, metadata: { ...result.content.metadata, retrySafety: false } } },
            { ...result, content: { ...result.content, metadata: { ...result.content.metadata, retrySafety: 'read_only' } } },
        ];
        for (const variant of variants) expect(collect(variant as typeof result)).toEqual([]);
    });
    it('records real per-operation receipts and keeps a partial undo partial', () => {
        const applied = applyOperationsExecutionResult(pending(), { intentId: 'intent-1', state: 'completed',
            operations: [{ operationId: 'op-1', status: 'succeeded', receiptId: 'receipt-1', path: 'a.md', name: 'vault_create', toolCallId: 'call-1' },
                { operationId: 'op-2', status: 'succeeded', receiptId: 'receipt-2', path: 'b.md', name: 'vault_create', toolCallId: 'call-1' }] })!;
        expect(applied.phase).toBe('completed');
        const partial = applyOperationsUndoResult(applied, { receiptId: 'receipt-1', operationId: 'op-1', status: 'undone' })!;
        expect(partial.phase).toBe('partial');
        expect(partial.actions?.map(action => action.phase)).toEqual(['undone', 'applied']);
        expect(applyOperationsUndoResult(partial, { receiptId: 'receipt-2', operationId: 'op-2', status: 'stale' })).toBeUndefined();
        expect(applyOperationsUndoResult(partial, { receiptId: 'receipt-2', operationId: 'op-2', status: 'undone' })?.phase).toBe('undone');
    });

    it('rejects owner or receipt substitution and forged whole-batch undo', () => {
        expect(applyOperationsExecutionResult(pending(), { intentId: 'other', state: 'completed', operations: [] })).toBeUndefined();
        expect(cloneActionStates([{ ...pending(), phase: 'completed' }])).toEqual([]);
        expect(cloneActionStates([{ ...pending(), revision: 1, phase: 'undone',
            receipt: { kind: 'operations-undo', intentId: 'intent-1' },
            actions: [{ actionId: 'op-1', phase: 'undone' }] }])).toEqual([]);
    });
});
