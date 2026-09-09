import { describe, expect, it } from '@jest/globals';
import { collectChatMemorySemanticSources, projectChatMemorySemanticText } from '../src/pa/chat-memory-admission';
import { chatMemorySemanticSourceFingerprint, createChatMemorySemanticReceipt, parseChatMemorySemanticReceipt, verifyChatMemorySemanticReceipt,
    type ChatMemorySemanticCandidate } from '../src/pa/chat-memory-semantic-receipt';

function fixture() {
    const [source] = collectChatMemorySemanticSources('conversation', [{
        conversationId: 'conversation', turnIndex: 0,
        user: { role: 'user', content: '我平时喜欢徒步。这次文案短一点。不要把后半句记成长期偏好。',
            hostProvenance: { version: 1, messageId: 'user-1', kind: 'writing_request' } },
        assistant: { role: 'assistant', content: '我喜欢摄影。' },
    }]);
    const projections = [{ source, presentedText: projectChatMemorySemanticText(source, 17) }];
    const candidate: ChatMemorySemanticCandidate = { text: '我平时喜欢徒步。', meaning: 'independent_personal_statement',
        kind: 'user_explicit', confidence: 'high', quotes: [{ messageId: 'user-1', quote: '我平时喜欢徒步。' }] };
    return { candidate, projections };
}

describe('B-135 host-bound semantic candidate receipts', () => {
    it('keeps suppression identity stable across wording and projection budgets for the same quote', () => {
        const { candidate, projections } = fixture();
        const first = createChatMemorySemanticReceipt(candidate, 'conversation', projections)!;
        const second = createChatMemorySemanticReceipt({ ...candidate, text: '喜欢徒步' }, 'conversation',
            [{ ...projections[0], presentedText: projections[0].source.text }])!;
        expect(first.candidateTextHash).not.toBe(second.candidateTextHash);
        expect(first.sources[0].projectionHash).not.toBe(second.sources[0].projectionHash);
        expect(chatMemorySemanticSourceFingerprint(first)).toBe(chatMemorySemanticSourceFingerprint(second));
    });
    it('binds a selected fact in a mixed writing message without upgrading host provenance or granting authority', () => {
        const { candidate, projections } = fixture();
        const receipt = createChatMemorySemanticReceipt({ ...candidate, confirmed: true, start: 99, hostKind: 'ordinary_user_statement' },
            'conversation', projections)!;
        expect(receipt.sources[0]).toMatchObject({ hostKind: 'writing_request', start: 0, end: 8 });
        expect(receipt).not.toHaveProperty('confirmed');
        expect(receipt).not.toHaveProperty('confirmedAt');
        expect(verifyChatMemorySemanticReceipt(receipt, candidate, 'conversation', projections)).toBe(true);
        expect(verifyChatMemorySemanticReceipt(receipt, { ...candidate, text: ` ${candidate.text}\n` }, 'conversation', projections)).toBe(true);
    });

    it.each(['task_instruction', 'quoted_material', 'draft_content', 'uncertain', undefined])('rejects non-independent semantics %s', (meaning) => {
        const { candidate, projections } = fixture();
        expect(createChatMemorySemanticReceipt({ ...candidate, meaning }, 'conversation', projections)).toBeUndefined();
    });

    it.each([{ kind: 'discussed' }, { confidence: 'low' }, { text: ' ' }, { quotes: [] },
        { quotes: [{ messageId: 'assistant-1', quote: '我喜欢摄影。' }] },
        { quotes: [{ messageId: 'user-1', quote: '不要把后半句记成长期偏好。' }] },
        { quotes: [{ messageId: 'user-1', quote: '我喜欢摄影。' }] },
    ])('rejects incomplete, weak, unsent or non-user evidence: %j', (patch) => {
        const { candidate, projections } = fixture();
        expect(createChatMemorySemanticReceipt({ ...candidate, ...patch }, 'conversation', projections)).toBeUndefined();
    });

    it('rejects duplicate citations, duplicate host identities and foreign conversations', () => {
        const { candidate, projections } = fixture();
        expect(createChatMemorySemanticReceipt({ ...candidate, quotes: [...candidate.quotes, ...candidate.quotes] }, 'conversation', projections)).toBeUndefined();
        expect(createChatMemorySemanticReceipt(candidate, 'conversation', [...projections, ...projections])).toBeUndefined();
        expect(createChatMemorySemanticReceipt(candidate, 'other', projections)).toBeUndefined();
    });

    it('revalidates exact candidate semantics and current source rather than trusting structurally valid data', () => {
        const { candidate, projections } = fixture();
        const receipt = createChatMemorySemanticReceipt(candidate, 'conversation', projections)!;
        for (const changed of [{ text: '这次文案短一点。' }, { kind: 'user_correction' }, { confidence: 'medium' },
            { meaning: 'task_instruction' }, { meaning: 'unknown' }, { meaning: undefined }]) {
            expect(verifyChatMemorySemanticReceipt(receipt, { ...candidate, ...changed }, 'conversation', projections)).toBe(false);
        }
        const changedSource = [{ ...projections[0], source: { ...projections[0].source, text: '我现在不喜欢徒步。' } }];
        expect(verifyChatMemorySemanticReceipt(receipt, candidate, 'conversation', changedSource)).toBe(false);
        expect(verifyChatMemorySemanticReceipt(receipt, candidate, 'conversation', [])).toBe(false);
        expect(verifyChatMemorySemanticReceipt(receipt, candidate, 'other', projections)).toBe(false);
        const forged = { ...receipt, sources: [{ ...receipt.sources[0], quoteHash: 'forged' }] };
        expect(parseChatMemorySemanticReceipt(forged)).toBeDefined();
        expect(verifyChatMemorySemanticReceipt(forged, candidate, 'conversation', projections)).toBe(false);
        const changedProjection = [{ ...projections[0], presentedText: projections[0].source.text }];
        expect(verifyChatMemorySemanticReceipt(receipt, candidate, 'conversation', changedProjection)).toBe(false);
    });

    it('requires its exact format and rule and creates a detached canonical value', () => {
        const { candidate, projections } = fixture();
        const receipt = createChatMemorySemanticReceipt(candidate, 'conversation', projections)!;
        for (const invalid of [null, {}, { version: 1, textHash: 'old', sources: [] }, { ...receipt, version: 2 },
            { ...receipt, rule: 'unknown' }, { ...receipt, sources: [] },
            ...[{ start: -1 }, { end: 100 }, { start: 1.5 }, { end: 0 }, { projectionChars: Infinity },
                { hostKind: 'ai_draft' }, { hostKind: 'explicit_style_action' }].map((patch) => ({ ...receipt, sources: [{ ...receipt.sources[0], ...patch }] })),
        ]) expect(parseChatMemorySemanticReceipt(invalid)).toBeUndefined();
        const parsed = parseChatMemorySemanticReceipt(receipt)!;
        parsed.sources[0].start = 1;
        expect(receipt.sources[0].start).toBe(0);
    });
});
