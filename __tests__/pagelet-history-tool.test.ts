import { createChatToolCapability } from '../src/ai-services/capability-adapter';
import type { AgentCapabilityContext } from '../src/ai-services/capability-types';
import { completeInputLineage } from '../src/ai-services/input-lineage';
import type { PageletChatAttachment } from '../src/ai-services/pagelet-handoff';
import { createPageletHistoryTool } from '../src/ai-services/pagelet-history-tool';

it('returns the complete saved Pagelet through bounded Unicode-safe chunks without adapter truncation', async () => {
    const body = 'A😀B' + '\u0001"\\😀'.repeat(5000);
    const anchor = { path: 'notes/anchor.md', mtime: 1, size: 1, contentHash: 'source-hash' };
    const lineage = completeInputLineage([{ kind: 'vault', path: anchor.path, via: 'pagelet' }]);
    const attachment: PageletChatAttachment = { schemaVersion: 1, conversationId: 'conversation',
        userMessageId: 'attached-user', originRunId: 'origin', inputLineage: lineage,
        handoff: { version: 1, id: 'pagelet', body, bodyHash: 'body-hash', anchor, sources: [anchor],
            sourceRefs: [{ path: anchor.path }], webUrls: ['https://example.com/original'],
            whyNow: [], triggerReason: 'related', preparedAt: 1, pipelineVersion: 'v1' } };
    const definition = createPageletHistoryTool({ attachmentIds: [attachment.userMessageId],
        admit: async () => ({ attachment, lineage }), isCurrent: () => true });
    const capability = createChatToolCapability(definition, { providerId: 'chat-pagelet-history' });
    const context = { host: { log: jest.fn() } } as unknown as AgentCapabilityContext;
    const first = await capability.execute({ action: 'read', attachmentId: attachment.userMessageId, limit: 2 }, context);
    expect(first.observation).toMatchObject({ text: 'A', offset: 0, endOffset: 1, nextOffset: 1 });
    let offset = 0;
    let joined = '';
    while (offset < body.length) {
        const result = await capability.execute({ action: 'read', attachmentId: attachment.userMessageId, offset }, context);
        expect(result.status).toBe('ok');
        const chunk = result.observation as { text: string; offset: number; endOffset: number; nextOffset: number | null };
        expect(JSON.stringify(chunk).length).toBeLessThanOrEqual(definition.outputBudgetChars);
        expect(chunk.text).toBe(body.slice(offset, chunk.endOffset));
        expect(chunk.endOffset).toBeGreaterThan(offset);
        expect(chunk.text).not.toMatch(/[\uD800-\uDBFF]$/u);
        expect(chunk).toMatchObject({ sourceRefs: attachment.handoff.sourceRefs, webUrls: attachment.handoff.webUrls });
        joined += chunk.text;
        offset = chunk.endOffset;
        expect(chunk.nextOffset).toBe(offset < body.length ? offset : null);
    }
    expect(joined).toBe(body);
});
