import { cloneDebugLineage, normalizeDebugUsage, projectDebugAttachments, projectDebugRequest, projectDebugSession, utf8Bytes } from '../src/agent-debug/projection';

describe('Agent Debug content projection', () => {
    it('retains the actual message/tool input but excludes protocol secrets, reasoning and inline media', () => {
        const projected = projectDebugRequest(JSON.stringify({ model: 'model', messages: [
            { role: 'user', content: [{ type: 'text', text: 'note body' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
            { role: 'assistant', reasoning_content: 'PRIVATE_REASONING', tool_calls: [
                { id: 't1', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: 'note.md', api_key: 'SECRET', reasoning: 'HIDDEN' }) } },
            ] },
        ], headers: { authorization: 'Bearer TOKEN' }, metadata: { internal: 'NO_METADATA' } }));
        expect(projected.text).toContain('note body');
        expect(projected.text).toContain('note.md');
        for (const excluded of ['PRIVATE_REASONING', 'AAAA', 'SECRET', 'HIDDEN', 'TOKEN', 'NO_METADATA']) expect(projected.text).not.toContain(excluded);
        expect(projected.redactions).toEqual(expect.arrayContaining(['reasoning', 'media', 'credentials']));
    });

    it('does not evaluate accessors or toJSON in session objects', () => {
        const accessor = jest.fn(() => 'secret');
        const toJSON = jest.fn(() => 'secret');
        const value = Object.defineProperty({ toJSON, safe: 'visible' }, 'token', { enumerable: true, get: accessor });
        expect(projectDebugSession(value).text).toContain('visible');
        expect(accessor).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
    });

    it('marks unknown bodies and oversized input without keeping a raw JSON fallback', () => {
        expect(projectDebugRequest('not json')).toMatchObject({ reason: 'unobservable_body' });
        expect(projectDebugRequest('{}', 1)).toMatchObject({ reason: 'capacity' });
        expect(projectDebugRequest({ messages: [] }).text).toContain('messages');
        expect(projectDebugSession({ text: 'x'.repeat(100) }, 40)).toMatchObject({ reason: 'capacity' });
        expect(projectDebugRequest({ messages: [{ content: 'x'.repeat(100) }] }, 40)).toMatchObject({ reason: 'capacity' });
        expect(utf8Bytes('A文😀')).toBe(8);
    });

    it('preserves partial token evidence without inventing a total or zero', () => {
        expect(normalizeDebugUsage({ prompt_tokens: 12 })).toEqual({ input: 12, complete: false });
        expect(normalizeDebugUsage({})).toBeUndefined();
        expect(cloneDebugLineage().completeness).toBe('unknown');
    });

    it('retains existing attachment metadata but never payload, paths or signed URLs', () => {
        const result = projectDebugAttachments([{ assetId: 'asset-id', contentHash: 'existing-hash', mime: 'image/png',
            width: 200, height: 100, byteLength: 2048, availability: 'provided', url: 'https://private/?token=SECRET',
            filePath: 'PRIVATE.md', base64: 'RAW_BYTES', blob: new Uint8Array([1, 2]) }]);
        expect(result.text).toContain('existing-hash'); expect(result.text).toContain('2048');
        for (const secret of ['SECRET', 'PRIVATE', 'RAW_BYTES']) expect(result.text).not.toContain(secret);
    });
});
