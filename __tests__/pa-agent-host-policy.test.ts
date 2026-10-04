import { describe, expect, it } from '@jest/globals';
import { createPaAgentHostPolicy } from '../src/ai-services/pa-agent-host-policy';
import type { PaAgentTurnSummary } from '../src/ai-services/pa-agent-loop';

describe('PA Agent Host protocol recovery', () => {
    it('corrects one empty response after a tool observation, then stops incomplete', async () => {
        const policy = createPaAgentHostPolicy();
        await policy.afterTurn(summary({ status: 'tool_results_ready', toolResults: [{
            role: 'toolResult', id: 'read-result', toolCallId: 'read-call', toolName: 'read_note',
            content: { promptText: 'Note observation', includeInNextPrompt: true }, isError: false, timestamp: 1,
        }] }));
        const empty = summary({ status: 'incomplete', diagnostics: [{ type: 'assistant_empty_response' }] });
        expect(await policy.afterTurn(empty)).toMatchObject({ action: 'continue', reason: 'corrective_turn' });
        expect(await policy.afterTurn(empty)).toMatchObject({ action: 'stop', status: 'incomplete' });
    });

    it.each(['completed', 'completed_with_warning', 'incomplete', 'error', 'aborted'] as const)(
        'keeps terminal %s immutable across later callbacks', async status => {
            const policy = createPaAgentHostPolicy();
            const decision = await policy.afterTurn(summary({ status }));
            expect(decision).toMatchObject({ action: 'stop', status });
            expect(await policy.afterTurn(summary({ status: 'tool_results_ready' }))).toBe(decision);
            expect(await policy.finalizeAfterTurn!(summary(), {
                defaultStatus: 'completed', reason: 'late_finalization',
            })).toBe(decision);
        },
    );

    it('retains a Loop-owned budget stop if finalization arrives before an ordinary terminal callback', async () => {
        const policy = createPaAgentHostPolicy();
        const decision = await policy.finalizeAfterTurn!(summary(), {
            defaultStatus: 'incomplete', reason: 'max_turns_reached',
        });
        expect(decision).toMatchObject({ action: 'stop', status: 'incomplete', reason: 'max_turns_reached' });
        expect(await policy.afterTurn(summary({ status: 'completed' }))).toBe(decision);
    });
});

function summary(overrides: Partial<PaAgentTurnSummary> = {}): PaAgentTurnSummary {
    return { turnId: 'turn-1', turnIndex: 0, status: 'completed',
        assistantMessage: { role: 'assistant', id: 'assistant-1', content: [], timestamp: 1 },
        committedFinalText: '', pendingTextReclassified: false, toolCalls: [], toolResults: [],
        diagnostics: [], metrics: [], timing: { turnIndex: 0, status: 'completed', elapsedMs: 0,
            modelElapsedMs: 0, modelChunkCount: 0, toolCallCount: 0, toolResultCount: 0 }, ...overrides };
}
