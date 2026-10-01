import { describe, expect, it } from '@jest/globals';
import { PaAgentContextManager, type PaAgentContextManagerInput } from '../src/ai-services/context/PaAgentContextManager';
import { canonicalContextJsonAsync, stringifyContextAsync, cloneContextJsonAsync, cloneCanonicalContextJsonAsync }
    from '../src/ai-services/context/PaAgentContextSerialization';
import { stableJson, prepareVaultObservationProjection } from '../src/ai-services/vault-observation-evidence';
import type { PaAgentMessage } from '../src/ai-services/chat-types';

function projectionInput(): PaAgentContextManagerInput {
    const transcript: PaAgentMessage[] = [];
    for (let index = 0; index < 160; index++) {
        transcript.push({ role: 'assistant', id: `assistant-${index}`, timestamp: index,
            content: [{ type: 'toolCall', id: `call-${index}`, name: 'read_note', input: { path: `notes/${index}.md` } }] });
        transcript.push({ role: 'toolResult', id: `result-${index}`, toolCallId: `call-${index}`,
            toolName: 'read_note', isError: false, timestamp: index,
            content: { promptText: `Evidence ${index}: 原始材料`, includeInNextPrompt: true,
                sourceRecords: [{ kind: 'context-used', dedupKey: `note-${index}`, path: `notes/${index}.md` }] } });
    }
    return { prompt: '比较来源，保留证据。', transcript, turnIndex: 160,
        availableSkills: 'None', toolDefinitions: 'read_note', maxHistoryChars: 80_000,
        maxObservationChars: 64_000, maxPromptChars: 120_000,
        chatHistory: [{ role: 'user', content: 'Existing constraint: do not write notes.' },
            { role: 'assistant', content: 'Understood.' }],
        formatToolObservations: messages => messages.map(message => message.role === 'toolResult'
            && message.content.includeInNextPrompt ? message.content.promptText : '').filter(Boolean).join('\n') };
}

describe('cooperative context preparation', () => {
    it('admits the first source-free request when the native authority fence is available', async () => {
        const projection = await prepareVaultObservationProjection({ transcript: [], history: [],
            validationMode: 'read_snapshot', getAuthorityEpoch: () => 'authority-1',
            revalidate: async () => { throw new Error('no observation should require validation'); } });
        await projection.binding.prepare();
        expect(() => projection.binding.assertCurrent()).not.toThrow();
        await expect(projection.binding.assertCurrentAsync!()).resolves.toBeUndefined();
        expect(projection.hasContractMaterial).toBe(false);
    });

    it('preserves exact JSON bytes and canonical fingerprints while servicing native events', async () => {
        const value = { z: 'x'.repeat(16_383) + '😀\ud800\n"\\</CHAT_HISTORY>', omitted: undefined,
            list: Array.from({ length: 400 }, (_, index) => ({ '10': index, '2': 2, text: '笔记', absent: undefined })),
            holes: [undefined, NaN, Infinity, null] };
        let eventHandled = false;
        setTimeout(() => { eventHandled = true; }, 0);
        expect(await stringifyContextAsync(value, undefined, 2)).toBe(JSON.stringify(value, null, 2));
        expect(await canonicalContextJsonAsync(value)).toBe(stableJson(value));
        expect(await cloneContextJsonAsync(value)).toEqual(JSON.parse(JSON.stringify(value)));
        expect(await cloneCanonicalContextJsonAsync(value)).toEqual(JSON.parse(stableJson(value)));
        expect(eventHandled).toBe(true);
    });

    it('keeps hygiene, action pairing and budget identical to synchronous projection', async () => {
        const input = projectionInput();
        const original = JSON.stringify(input.transcript);
        const expected = new PaAgentContextManager().forPrompt(input);
        let nativeInputHandled = false;
        let asyncFormats = 0;
        setTimeout(() => { nativeInputHandled = true; }, 0);
        const actual = await new PaAgentContextManager().forPromptAsync({ ...input,
            formatToolObservationsAsync: async (messages, turnIndex) => {
                asyncFormats++;
                return input.formatToolObservations(messages, turnIndex);
            } });
        expect(actual).toEqual(expected);
        expect(actual.history.sourceMessages).toEqual(expected.history.sourceMessages);
        expect(JSON.stringify(input.transcript)).toBe(original);
        expect(nativeInputHandled).toBe(true);
        expect(asyncFormats).toBeGreaterThan(0);
    });

    it('observes cancellation during preparation before producing a provider projection', async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 0);
        await expect(new PaAgentContextManager().forPromptAsync(projectionInput(), controller.signal))
            .rejects.toMatchObject({ name: 'AbortError' });
    });
});
