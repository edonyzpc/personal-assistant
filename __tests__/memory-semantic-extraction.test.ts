import { describe, expect, it, jest } from '@jest/globals';
import { deriveSemanticProfileKey, TypeAUserProfileExtractor, type TypeAExtractionInput } from '../src/ai-services/memory-extraction/type-a-extractor';
import { verifyChatMemorySemanticReceipt } from '../src/pa/chat-memory-semantic-receipt';
import { MemoryExtractionScheduler, type TypeAAdmissionBatch } from '../src/ai-services/memory-extraction/extraction-scheduler';
import { MemoryUserProfileStore } from '../src/ai-services/memory-extraction/profile-store';
import type { App } from 'obsidian';
import type { ChatHistoryManager } from '../src/chat/chat-history-manager';
import semanticTrace from './fixtures/b135-semantic-extraction-trace.json';

jest.mock('obsidian');

function input(text = '我平时喜欢徒步。这次文案短一点。'): TypeAExtractionInput {
    return { conversation: { id: 'conversation', title: 'Writing', createdAt: '2026-09-09T00:00:00Z',
        updatedAt: '2026-09-09T00:00:00Z', turnCount: 1, preview: '' },
    turns: [{ conversationId: 'conversation', turnIndex: 0,
        user: { role: 'user', content: text, hostProvenance: { version: 1, messageId: 'user-1', kind: 'writing_request' } },
        assistant: { role: 'assistant', content: 'AI draft claims the user likes sailing.' } }],
    now: () => new Date('2026-09-09T01:00:00Z') };
}

function candidate(text = '我平时喜欢徒步。', quote = text) {
    return { text, meaning: 'independent_personal_statement', kind: 'user_explicit', confidence: 'high',
        quotes: [{ messageId: 'user-1', quote }] };
}

describe('Type A semantic extraction', () => {
    it.each(semanticTrace.cases)('replays current-model source-bound semantic output: $id', async (recorded) => {
        const response = semanticTrace.results.find((result) => result.id === recorded.id)!;
        const invoke = jest.fn(async (prompt: string) => {
            expect(prompt).toBe(recorded.prompt);
            return response.content;
        });
        const result = await new TypeAUserProfileExtractor().extractSemanticCandidatesWithLLM(
            recorded.input as TypeAExtractionInput, invoke,
        );
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') throw new Error('Provider trace was rejected');
        expect(result.candidates).toHaveLength(recorded.id === 'mixed' ? 1 : recorded.id === 'two_facts' ? 2 : 0);
        for (const candidate of result.candidates) {
            expect(verifyChatMemorySemanticReceipt(candidate.chatSemanticReceipt, candidate,
                recorded.input.conversation.id, result.projections)).toBe(true);
            expect(candidate.text).not.toMatch(/正式|格式要求|简短通知|只用当前笔记/);
        }
    });
    it('stores opaque identity without conflating statements that share their first ten words', () => {
        const prefix = 'My personal preference is to organize all recurring morning meetings';
        const first = deriveSemanticProfileKey(`${prefix} before Tuesday.`);
        expect(first).toMatch(/^semantic-[a-f0-9]{8}$/);
        expect(first).toBe(deriveSemanticProfileKey(`${prefix.toUpperCase()} before Tuesday!`));
        expect(first).not.toBe(deriveSemanticProfileKey(`${prefix} after Thursday.`));
        expect(first).not.toContain('meeting');
    });
    it('uses one model call for mixed writing input and binds only the cited independent statement', async () => {
        const invoke = jest.fn(async (prompt: string) => {
            expect(prompt).toContain('我平时喜欢徒步。这次文案短一点。');
            expect(prompt).toContain('"hostKind":"writing_request"');
            expect(prompt).not.toContain('AI draft claims');
            return JSON.stringify({ extractions: [candidate(),
                { ...candidate('这次文案短一点。'), meaning: 'task_instruction' }] });
        });
        const result = await new TypeAUserProfileExtractor().extractSemanticCandidatesWithLLM(input(), invoke);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(result.status).toBe('parsed');
        if (result.status !== 'parsed') throw new Error('Expected parsed result');
        expect(result.candidates).toHaveLength(1);
        const fact = result.candidates[0];
        expect(fact.text).toBe('我平时喜欢徒步。');
        expect(fact).not.toHaveProperty('chatEvidence');
        expect(fact).not.toHaveProperty('confirmed');
        expect(fact.chatSemanticReceipt.sources[0].hostKind).toBe('writing_request');
        expect(verifyChatMemorySemanticReceipt(fact.chatSemanticReceipt, fact, 'conversation', result.projections)).toBe(true);
    });

    it('rejects quotes from the unsent tail even though the host holds the complete message', async () => {
        const text = `我平时喜欢徒步。${'填'.repeat(500)}我偏好长回复。`;
        const invoke = jest.fn(async (prompt: string) => {
            expect(prompt).not.toContain('我偏好长回复。');
            return JSON.stringify({ extractions: [candidate(), candidate('我偏好长回复。')] });
        });
        const result = await new TypeAUserProfileExtractor().extractSemanticCandidatesWithLLM(input(text), invoke);
        if (result.status !== 'parsed') throw new Error('Expected parsed result');
        expect(result.candidates.map((entry) => entry.text)).toEqual(['我平时喜欢徒步。']);
        expect(result.projections[0].source.text).toBe(text);
        expect(result.projections[0].presentedText.length).toBe(500);
    });

    it.each(['throw', 'invalid-json', 'invalid-shape'] as const)('retries %s without falling back to regex-derived learning', async (failure) => {
        const extractor = new TypeAUserProfileExtractor();
        const fallback = jest.spyOn(extractor, 'extractCandidates');
        const invoke = jest.fn(async () => {
            if (failure === 'throw') throw new Error('Provider unavailable');
            return failure === 'invalid-json' ? 'Remember I prefer concise answers' : '{"extractions":null}';
        });
        const result = await extractor.extractSemanticCandidatesWithLLM(input('Remember I prefer concise answers.'), invoke);
        expect(result.status).toBe('retry');
        expect(fallback).not.toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(result).not.toHaveProperty('candidates');
    });

    it('charges escaped multi-message content to the shared budget and rejects a citation to an omitted message', async () => {
        const source = input();
        source.turns = Array.from({ length: 6 }, (_, index) => ({ conversationId: 'conversation', turnIndex: index,
            user: { role: 'user' as const, content: `偏好${index}。${'"'.repeat(600)}`,
                hostProvenance: { version: 1 as const, messageId: `user-${index}`, kind: 'writing_request' as const } },
            assistant: { role: 'assistant' as const, content: '' } }));
        const invoke = jest.fn(async (prompt: string) => {
            const material = prompt.slice(prompt.indexOf('User messages:\n') + 'User messages:\n'.length);
            expect(material.length).toBeLessThanOrEqual(2000);
            expect(material).toContain('user-0');
            expect(material).not.toContain('user-5');
            return JSON.stringify({ extractions: [{ ...candidate('偏好0。'), quotes: [{ messageId: 'user-0', quote: '偏好0。' }] },
                { ...candidate('偏好5。'), quotes: [{ messageId: 'user-5', quote: '偏好5。' }] }] });
        });
        const result = await new TypeAUserProfileExtractor().extractSemanticCandidatesWithLLM(source, invoke);
        if (result.status !== 'parsed') throw new Error('Expected parsed result');
        expect(result.candidates.map((entry) => entry.text)).toEqual(['偏好0。']);
        expect(result.projections.some((entry) => entry.source.messageId === 'user-5')).toBe(false);
    });

    it('does not invoke the model when every host source is excluded', async () => {
        const source = input();
        source.turns[0].user.hostProvenance!.kind = 'ai_draft';
        const invoke = jest.fn(async () => JSON.stringify({ extractions: [candidate()] }));
        expect(await new TypeAUserProfileExtractor().extractSemanticCandidatesWithLLM(source, invoke))
            .toEqual({ status: 'parsed', candidates: [], projections: [] });
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe('semantic scheduler source lifetime and governed-only admission', () => {
    async function canonicalSetup(options: { wrongCachedId?: boolean; duplicate?: 'key' | 'id' | 'canonical-id' } = {}) {
        const data = input();
        const extractor = new TypeAUserProfileExtractor();
        const extracted = await extractor.extractSemanticCandidatesWithLLM(data, async () => JSON.stringify({ extractions: [candidate()] }));
        if (extracted.status !== 'parsed') throw new Error('Invalid fixture');
        const fact = extracted.candidates[0];
        const ids: Record<string, string> = {};
        const batches: TypeAAdmissionBatch[] = [];
        const create = async () => {
            const store = new MemoryUserProfileStore();
            if (options.wrongCachedId) {
                const cached = extractor.mergeSemanticCandidates(null, [fact], data.now!());
                cached.records[0].profileRecordId = 'profile-11111111111111111111111111111111';
                await store.setProfile(cached);
            }
            const invoke = jest.fn(async () => JSON.stringify({ extractions: [candidate()] }));
            const scheduler = new MemoryExtractionScheduler({ app: {} as App,
                chatHistoryManager: {
                    captureSourceLifetime: () => () => true,
                    findConversation: async (id: string) => ({ ...data.conversation, id }),
                    getTurns: async (id: string) => data.turns.map((turn) => ({ ...turn, conversationId: id })),
                } as unknown as ChatHistoryManager,
                userProfileStore: store, semanticTypeA: true, now: data.now,
                createModelForExtraction: async () => ({ invoke }),
                captureTypeAAdmissionBaseline: async () => ({ version: 1, capturedCommitSequence: 0, targets: {},
                    profileRecordIdsByKey: { ...ids } }),
                admitTypeACandidates: async (batch) => {
                    batches.push(batch);
                    for (const record of batch.proposed.records) ids[record.key] = record.profileRecordId!;
                    return { status: 'processed' };
                },
            });
            if (options.duplicate) {
                const localExtractor = (scheduler as unknown as { typeAExtractor: TypeAUserProfileExtractor }).typeAExtractor;
                const merge = localExtractor.mergeSemanticCandidates.bind(localExtractor);
                jest.spyOn(localExtractor, 'mergeSemanticCandidates').mockImplementation((...args) => {
                    const result = merge(...args);
                    result.records.push({ ...result.records[0],
                        ...(options.duplicate === 'key' ? { profileRecordId: 'profile-other' } : { key: 'other-key' }),
                        ...(options.duplicate === 'canonical-id' ? { profileRecordId: 'profile-33333333333333333333333333333333' } : {}) });
                    return result;
                });
            }
            return { scheduler, invoke };
        };
        return { create, ids, batches, key: fact.key };
    }

    it('reuses host canonical IDs for the same fact across conversations with empty caches and after restart', async () => {
        const f = await canonicalSetup();
        const first = await f.create();
        try {
            await first.scheduler.runTypeAExtraction('first');
            const id = f.batches[0].proposed.records[0].profileRecordId;
            await first.scheduler.runTypeAExtraction('second');
            expect(f.batches[1].current).toBeNull();
            expect(f.batches[1].proposed.records[0]).toMatchObject({ profileRecordId: id, conversationIds: ['second'] });
            first.scheduler.dispose();
            const restarted = await f.create();
            try {
                await restarted.scheduler.runTypeAExtraction('third');
                expect(f.batches[2].current).toBeNull();
                expect(f.batches[2].proposed.records[0]).toMatchObject({ profileRecordId: id, conversationIds: ['third'] });
                expect(f.batches[2].candidates[0]).not.toHaveProperty('profileRecordId');
            } finally { restarted.scheduler.dispose(); }
        } finally { first.scheduler.dispose(); }
    });

    it('corrects a stale cached ID using the host map without rewriting the captured current snapshot', async () => {
        const f = await canonicalSetup({ wrongCachedId: true });
        f.ids[f.key] = 'profile-22222222222222222222222222222222';
        const running = await f.create();
        try {
            await running.scheduler.runTypeAExtraction('conversation');
            expect(f.batches[0].current?.records[0].profileRecordId).toBe('profile-11111111111111111111111111111111');
            expect(f.batches[0].proposed.records[0].profileRecordId).toBe('profile-22222222222222222222222222222222');
        } finally { running.scheduler.dispose(); }
    });

    it.each(['key', 'id', 'canonical-id'] as const)('retries an ambiguous proposed %s without admission or cursor advancement', async (duplicate) => {
        const f = await canonicalSetup({ duplicate });
        if (duplicate === 'canonical-id') f.ids[f.key] = 'profile-33333333333333333333333333333333';
        const running = await f.create();
        try {
            await running.scheduler.runTypeAExtraction('conversation');
            await running.scheduler.runTypeAExtraction('conversation');
            expect(f.batches).toEqual([]);
            expect(running.invoke).toHaveBeenCalledTimes(2);
        } finally { running.scheduler.dispose(); }
    });

    it('does not inherit stronger legacy confidence, confirmation or unrelated conversations while merging a semantic proposal', async () => {
        const extractor = new TypeAUserProfileExtractor();
        const result = await extractor.extractSemanticCandidatesWithLLM(input(), async () => JSON.stringify({ extractions: [{ ...candidate(), kind: 'inferred_behavior', confidence: 'medium' }] }));
        if (result.status !== 'parsed') throw new Error('Expected semantic fixture');
        const semantic = result.candidates[0];
        const merged = extractor.mergeSemanticCandidates({ updatedAt: 'before', markdown: '', records: [{
            key: semantic.key, text: 'An older longer unrelated formulation', kind: 'user_correction', confidence: 'high',
            conversationId: 'old', observedAt: 'before', conversationIds: ['old'], occurrences: 9, confirmed: true,
            chatEvidence: { version: 1, textHash: 'old', sources: [] },
        }] }, [semantic]);
        expect(merged.records[0]).toMatchObject({ text: semantic.text, kind: 'inferred_behavior', confidence: 'medium',
            confirmed: false, occurrences: 1, conversationId: 'conversation', conversationIds: ['conversation'] });
        expect(merged.records[0]).not.toHaveProperty('chatEvidence');
        expect(merged.records[0].chatSemanticReceipt).toEqual(semantic.chatSemanticReceipt);
        expect(extractor.mergeSemanticCandidates(null, [{ ...semantic, text: 'Changed without receipt' }]).records).toEqual([]);
    });
    function setup(mode: 'ok' | 'retry' | 'error' | 'delete' | 'close' | 'no-admit' | 'no-lease' | 'source-edit' | 'setup-edit' = 'ok') {
        const data = input();
        let live = true;
        let turns = data.turns;
        const store = new MemoryUserProfileStore();
        const write = jest.spyOn(store, 'setProfile');
        const batches: TypeAAdmissionBatch[] = [];
        let scheduler: MemoryExtractionScheduler;
        const invoke = jest.fn(async () => {
            if (mode === 'error') throw new Error('Model unavailable');
            if (mode === 'delete') { live = false; turns = []; }
            if (mode === 'source-edit') turns = [{ ...turns[0], user: { ...turns[0].user, content: 'Changed original source' } }];
            if (mode === 'close') scheduler.dispose();
            return JSON.stringify({ extractions: [candidate()] });
        });
        const admit = jest.fn(async (batch: TypeAAdmissionBatch) => {
            batches.push(batch);
            return { status: mode === 'retry' ? 'retry' as const : 'processed' as const };
        });
        const manager = { findConversation: jest.fn(async () => data.conversation),
            getTurns: jest.fn(async () => turns),
            ...(mode === 'no-lease' ? {} : { captureSourceLifetime: () => () => live }) };
        scheduler = new MemoryExtractionScheduler({ app: {} as App, chatHistoryManager: manager as unknown as ChatHistoryManager,
            userProfileStore: store, semanticTypeA: true, now: data.now,
            createModelForExtraction: async () => {
                if (mode === 'setup-edit') turns = [];
                return { invoke };
            },
            ...(mode === 'no-admit' ? {} : { admitTypeACandidates: admit }) });
        return { scheduler, invoke, admit, write, batches, manager, expire: () => { live = false; } };
    }

    it('carries actual mixed-source receipts into proposed unconfirmed rows and final host lifetime', async () => {
        const f = setup();
        try {
            await f.scheduler.runTypeAExtraction('conversation');
            expect(f.batches).toHaveLength(1);
            const batch = f.batches[0], extracted = batch.candidates[0];
            expect(extracted).toMatchObject({ text: '我平时喜欢徒步。', meaning: 'independent_personal_statement', kind: 'user_explicit', confidence: 'high' });
            expect(extracted).not.toHaveProperty('chatEvidence');
            expect(batch.proposed.records[0]).toMatchObject({ text: extracted.text, confirmed: false, conversationIds: ['conversation'] });
            expect(batch.proposed.records[0]).not.toHaveProperty('chatEvidence');
            expect(verifyChatMemorySemanticReceipt(extracted.chatSemanticReceipt, extracted, 'conversation', batch.semanticProjections!)).toBe(true);
            expect(f.manager.getTurns).toHaveBeenCalledTimes(3);
            expect(batch.isCurrent?.()).toBe(true);
            f.expire();
            expect(batch.isCurrent?.()).toBe(false);
            expect(f.write).not.toHaveBeenCalled();
        } finally { f.scheduler.dispose(); }
    });

    it.each(['retry', 'error', 'delete', 'close', 'no-admit', 'no-lease', 'source-edit', 'setup-edit'] as const)('never writes direct Profile or treats %s as processed', async (mode) => {
        const f = setup(mode);
        try {
            await f.scheduler.runTypeAExtraction('conversation');
            expect(f.write).not.toHaveBeenCalled();
            if (mode !== 'retry') expect(f.admit).not.toHaveBeenCalled();
            if (mode === 'retry' || mode === 'error') {
                await f.scheduler.runTypeAExtraction('conversation');
                expect(f.invoke).toHaveBeenCalledTimes(2);
            }
            if (mode === 'no-admit' || mode === 'no-lease' || mode === 'setup-edit') expect(f.invoke).not.toHaveBeenCalled();
        } finally { f.scheduler.dispose(); }
    });
});
