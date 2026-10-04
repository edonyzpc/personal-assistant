import { PaAgentContextManager } from '../src/ai-services/context/PaAgentContextManager';
import { PaAgentContextProjector, renderProjectedHistoryEntries } from '../src/ai-services/context/PaAgentContextProjector';
import { planHistoryContext, type ColdWritingVersion } from '../src/ai-services/context/PaAgentHistoryContextPlan';
import { buildPaAgentFinalMessages, buildPaAgentFinalMessagesAsync, formatToolObservations,
    measurePaAgentRequestEnvelope } from '../src/ai-services/pa-agent-prompts';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { WritingVersionService } from '../src/chat/writing-versions';
import { cloneActionStates } from '../src/ai-services/pa-agent-result-facts';
import { completeInputLineage } from '../src/ai-services/input-lineage';
import type { ChatMessage, PaAgentMessage } from '../src/ai-services/chat-types';

async function writingHistory(count: number, large = false) {
    const service = new WritingVersionService(new MemoryChatHistoryStore(), () => 1);
    const history: ChatMessage[] = [];
    const versions = new Map<string, ColdWritingVersion>();
    for (let i = 0; i < count; i++) {
        const body = large ? Array.from({ length: 80 }, (_, j) =>
            `Draft ${i} paragraph ${j}: completed article content item ${i * 80 + j}, reference ${7919 * (i * 80 + j)}.`).join('\n')
            : `EXACT_WRITING_BODY_${i}`;
        const version = await service.create({ requestId: `request-${i}`, messageId: `assistant-${i}`,
            conversationId: 'chat', turnIndex: i, text: body, images: [] });
        const states = cloneActionStates([{ schemaVersion: 1, owner: 'writing', operationId: version.id,
            phase: 'ready', revision: 0, origin: { runId: `run-${i}`, turnId: `turn-${i}`,
                assistantId: `assistant-${i}`, resultId: `assistant-${i}` },
            inputLineage: completeInputLineage(), receipt: { kind: 'writing-version', versionId: version.id } }]);
        history.push({ role: 'user', content: `Write draft ${i}.` }, { role: 'assistant', content: body,
            writingVersionId: version.id, actionStates: states, canonicalTurn: { schemaVersion: 1,
                runId: `run-${i}`, turnId: `turn-${i}`, actionStates: states, messages: [
                    { role: 'assistant', id: `assistant-${i}`, timestamp: i, content: [
                        { type: 'toolCall', id: `call-${i}`, name: 'present_writing', input: { body, contextHandle: `context-${i}` } },
                    ] },
                ] } });
        versions.set(version.id, { textHash: version.textHash, text: body });
    }
    return { history, versions };
}

function project(history: ChatMessage[], coldWritingVersions?: ReadonlyMap<string, ColdWritingVersion>) {
    return new PaAgentContextManager().forPrompt({ prompt: 'NEW_QUESTION_ONLY', transcript: [], turnIndex: 0,
        chatHistory: history, coldWritingVersions, availableSkills: 'None', toolDefinitions: 'None',
        maxHistoryChars: 60_000, maxPromptChars: 120_000, maxObservationChars: 64_000, formatToolObservations,
        measurePromptEnvelope: parts => measurePaAgentRequestEnvelope({ input: parts.input,
            available_skills: parts.availableSkills, tool_definitions: parts.toolDefinitions,
            tool_observations: parts.toolObservations, operations_guidance: 'No writable capabilities are bound.' }, [],
        buildPaAgentFinalMessages(parts.input, parts.actionHistory, 'native', undefined, parts.history, parts.currentInput, parts)),
    });
}

describe('single Writing history projection', () => {
    it('fits twelve legal saved works, keeps two complete recent turns, and never readds cold bodies in either adapter', async () => {
        const f = await writingHistory(12, true);
        const original = JSON.stringify(f.history);
        const baseline = project(f.history);
        const projected = project(f.history, f.versions);
        expect(baseline.outcome.admission).toBe('fit');
        expect(baseline.budget.promptChars).toBeGreaterThan(projected.budget.promptChars);
        expect(projected.outcome.admission).toBe('fit');
        expect(projected.history.entries.filter(entry => entry.kind === 'writing_reference')).toHaveLength(10);
        expect(projected.history.sourceMessages).toEqual(f.history);
        expect(projected.history.text).toBe(renderProjectedHistoryEntries(projected.history.entries));
        expect(planHistoryContext(f.history, 60_000, 8000, f.versions).mode).toBe('full');
        for (const mode of ['native', 'compat'] as const) {
            const messages = buildPaAgentFinalMessages(projected.input, [], mode, undefined,
                projected.history, projected.currentInput, projected);
            const wire = JSON.stringify(messages.map(message => message.toDict()));
            const asyncMessages = await buildPaAgentFinalMessagesAsync(projected.input, [], mode, undefined,
                projected.history, projected.currentInput, undefined, projected);
            expect(asyncMessages.map(message => message.toDict())).toEqual(messages.map(message => message.toDict()));
            for (let i = 0; i < 12; i++) {
                const versionId = f.history[i * 2 + 1].writingVersionId!;
                expect(wire).toContain(versionId);
                expect(wire).toContain('ready');
                if (i < 10) expect(wire).not.toContain(`Draft ${i} paragraph 0:`);
                else expect(wire).toContain(`Draft ${i} paragraph 0:`);
            }
            expect(wire.match(/NEW_QUESTION_ONLY/g)).toHaveLength(1);
            expect(wire).not.toContain('inputLineage');
        }
        expect(JSON.stringify(f.history)).toBe(original);
        expect(project(f.history).outcome.admission).toBe('fit');
    });

    it('preserves selected, mixed, unbound and mismatched legacy groups instead of fabricating a reference', async () => {
        const f = await writingHistory(6);
        f.versions.delete(f.history[1].writingVersionId!); // Runtime excludes the selected parent.
        const mixed = f.history[3].canonicalTurn!.messages[0] as Extract<PaAgentMessage, { role: 'assistant' }>;
        mixed.content.push({ type: 'toolCall', id: 'other-call', name: 'read_note', input: { path: 'note.md' } });
        delete f.history[5].actionStates;
        delete f.history[5].canonicalTurn!.actionStates;
        const wrong = f.history[7].writingVersionId!;
        f.versions.set(wrong, { ...f.versions.get(wrong)!, text: 'A different immutable body' });
        const projected = project(f.history, f.versions);
        expect(projected.history.entries.every(entry => entry.kind !== 'writing_reference')).toBe(true);
        for (let i = 0; i < 6; i++) expect(projected.history.text).toContain(`EXACT_WRITING_BODY_${i}`);
    });

    it('retains a preceding call/result group and actual partial-save state while cooling only the final Writing group', async () => {
        const f = await writingHistory(3);
        const old = f.history[1];
        (old.canonicalTurn!.messages[0] as Extract<PaAgentMessage, { role: 'assistant' }>).content.unshift(
            { type: 'text', text: 'KEEP_EXPLANATION_FOR_THIS_WORK' });
        const state = old.actionStates![0];
        old.actionStates = cloneActionStates([{ ...state, phase: 'partial', revision: 1,
            receipt: { kind: 'writing-save', versionId: state.operationId, saveId: 'save-1', state: 'partial', noteState: 'created' } }]);
        old.canonicalTurn!.messages.unshift(
            { role: 'assistant', id: 'read-assistant', timestamp: 0, content: [
                { type: 'toolCall', id: 'read-call', name: 'get_writing_context', input: { parentHandle: null } },
            ] },
            { role: 'toolResult', id: 'read-result', timestamp: 0, toolName: 'get_writing_context', toolCallId: 'read-call',
                isError: false, content: { includeInNextPrompt: true, promptText: 'CONTEXT_READ_EVIDENCE', metadata: { outcome: 'success' } } },
        );
        const projected = project(f.history, f.versions);
        const cold = projected.history.entries.find(entry => entry.kind === 'writing_reference');
        expect(cold).toMatchObject({ projection: { reference: { actionState: { phase: 'partial',
            saves: [{ saveId: 'save-1', state: 'partial', noteState: 'created' }] } } } });
        for (const mode of ['native', 'compat'] as const) {
            const wire = JSON.stringify(buildPaAgentFinalMessages(projected.input, [], mode, undefined,
                projected.history, projected.currentInput, projected).map(message => message.toDict()));
            expect(wire).toContain('CONTEXT_READ_EVIDENCE');
            expect(wire).toContain('KEEP_EXPLANATION_FOR_THIS_WORK');
            expect(wire).toContain('read-call');
            expect(wire).toContain('partial');
            expect(wire).not.toContain('EXACT_WRITING_BODY_0');
        }
    });

    it('keeps a bound semantic correction in entries and excludes sourceMessages from outbound reconstruction', async () => {
        const f = await writingHistory(3);
        f.history.splice(2, 0, { role: 'user', content: 'Old constraint ' + 'Z'.repeat(2000) },
            { role: 'assistant', content: 'Acknowledged ' + 'Q'.repeat(2000) });
        const projection = new PaAgentContextProjector().projectUserInput({ prompt: 'new question', chatHistory: f.history,
            coldWritingVersions: f.versions, maxHistoryChars: 3500,
            summaries: { history: { text: JSON.stringify({ constraints: [{ text: 'LATEST_CORRECTION_KEEP', sourceMessages: [3] }] }),
                sourceMessages: f.history.slice(0, 4) } } });
        expect(projection.history.entries.some(entry => entry.kind === 'summary')).toBe(true);
        for (const mode of ['native', 'compat'] as const) {
            const wire = JSON.stringify(buildPaAgentFinalMessages(projection.input, [], mode, undefined,
                projection.history, projection.currentInput, projection).map(message => message.toDict()));
            expect(wire).toContain('LATEST_CORRECTION_KEEP');
            expect(wire).not.toContain('EXACT_WRITING_BODY_0');
            expect(wire).not.toContain('Z'.repeat(100));
        }
    });
});
