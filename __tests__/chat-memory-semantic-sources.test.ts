import { describe, expect, it } from '@jest/globals';
import type { PersistedTurn } from '../src/chat/chat-history-store';
import type { ChatHostProvenance } from '../src/ai-services/chat-provenance';
import { collectChatMemorySemanticSources, collectChatMemorySources, locateChatMemoryQuote, projectChatMemorySemanticText } from '../src/pa/chat-memory-admission';

function turn(text: string, kind?: ChatHostProvenance['kind'], index = 0, id = 'user-1'): PersistedTurn {
    return { conversationId: 'conversation', turnIndex: index,
        user: { role: 'user', content: text, ...(kind ? { hostProvenance: { version: 1, messageId: id, kind } } : {}) },
        assistant: { role: 'assistant', content: 'Generated preference that must never become user evidence' },
    };
}

describe('B-135 semantic review input and host quote location', () => {
    it.each(['writing_request', 'user_local_edit'] as const)('preserves mixed input for review without upgrading %s to ordinary', (kind) => {
        const input = turn('我平时喜欢徒步。这次文案短一点。', kind);
        const sources = collectChatMemorySemanticSources('conversation', [input]);
        expect(sources).toHaveLength(1);
        expect(sources[0]).toMatchObject({ text: input.user.content, hostKind: kind });
        expect(collectChatMemorySources('conversation', [input])).toEqual([]);
        const quote = locateChatMemoryQuote(sources[0], sources[0].text, '我平时喜欢徒步。');
        expect(quote).toMatchObject({ hostKind: kind, start: 0, end: 8 });
        expect(quote).not.toHaveProperty('confirmed');
        expect(quote).not.toHaveProperty('kind');
    });

    it('keeps unmarked historical writing unknown rather than treating it as ordinary', () => {
        const source = collectChatMemorySemanticSources('conversation', [turn('这次短一点')])[0];
        expect(source.hostKind).toBe('unclassified');
        expect(source.messageId).toMatch(/^legacy-/);
    });

    it('excludes generated/style-action/foreign input and repeated message identities', () => {
        const inputs = [turn('Real fact', 'writing_request'), turn('Duplicate draft', 'ai_draft', 1),
            turn('Style action', 'explicit_style_action', 2, 'style'),
            { ...turn('Other conversation', 'ordinary_user_statement', 3, 'foreign'), conversationId: 'other' }];
        expect(collectChatMemorySemanticSources('conversation', inputs)).toEqual([]);
    });

    it.each([null, { version: 2, messageId: 'user-1', kind: 'ordinary_user_statement' }, {}])('does not fall back when supplied provenance is invalid: %j', (invalid) => {
        const input = turn('Real fact');
        Object.assign(input.user, { hostProvenance: invalid });
        expect(collectChatMemorySemanticSources('conversation', [input])).toEqual([]);
    });

    it('locates exact quotes only in the actual projected prefix and rejects duplicate matches', () => {
        const source = collectChatMemorySemanticSources('conversation', [turn('前缀🙂独立事实。重复重复。未发送尾部', 'writing_request')])[0];
        const presented = projectChatMemorySemanticText(source, 14);
        expect(locateChatMemoryQuote(source, presented, '独立事实。')).toMatchObject({ start: 4, end: 9, projectionChars: presented.length });
        for (const quote of ['未发送尾部', '重复', '不存在', '']) expect(locateChatMemoryQuote(source, presented, quote)).toBeUndefined();
        expect(locateChatMemoryQuote(source, '伪造投影', '伪造')).toBeUndefined();
        expect(locateChatMemoryQuote({ ...source, text: source.text + 'changed' }, presented, '独立事实。')).toBeUndefined();
    });

    it('does not cut surrogate pairs in projections or quote boundaries', () => {
        const source = collectChatMemorySemanticSources('conversation', [turn('a🙂b', 'writing_request')])[0];
        expect(projectChatMemorySemanticText(source, 2)).toBe('a');
        expect(projectChatMemorySemanticText(source, 3)).toBe('a🙂');
        expect(locateChatMemoryQuote(source, source.text, '🙂')).toMatchObject({ start: 1, end: 3 });
        expect(locateChatMemoryQuote(source, source.text, '\ud83d')).toBeUndefined();
        expect(locateChatMemoryQuote(source, source.text, '\ude42')).toBeUndefined();
        expect(locateChatMemoryQuote(source, 'a\ud83d', 'a')).toBeUndefined();
        for (const budget of [0, -1, Infinity, 1.5]) expect(projectChatMemorySemanticText(source, budget)).toBe('');
    });
});
