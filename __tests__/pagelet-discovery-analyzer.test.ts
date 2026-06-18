import { describe, expect, it } from '@jest/globals';
import { buildDiscoveryResultFromFindings } from '../src/pagelet/DiscoveryAnalyzer';

describe('buildDiscoveryResultFromFindings', () => {
    it('maps connection findings to the mentioned related note instead of current note', () => {
        const result = buildDiscoveryResultFromFindings([{
            text: 'The current note and Pagelet Smoke Cancel both lack explicit decision criteria.',
            sourceFile: 'pagelet-smoke-golden.md',
            sourceTitle: 'Pagelet Smoke Golden',
            category: 'connection',
        }], 'pagelet-smoke-golden.md', [
            { path: 'pagelet-smoke-cancel.md' },
            { path: 'pagelet-provider-en.md' },
        ]);

        expect(result.connections[0]).toEqual(expect.objectContaining({
            fromNote: 'pagelet-smoke-golden.md',
            toNote: 'pagelet-smoke-cancel.md',
        }));
    });

    it('keeps an explicit non-current sourceFile when the model provides one', () => {
        const result = buildDiscoveryResultFromFindings([{
            text: 'Both notes need rollback criteria.',
            sourceFile: 'pagelet-provider-en.md',
            sourceTitle: 'Pagelet Provider English',
            category: 'connection',
        }], 'pagelet-smoke-golden.md', [
            { path: 'pagelet-smoke-cancel.md' },
        ]);

        expect(result.connections[0]?.toNote).toBe('pagelet-provider-en.md');
    });

    it('matches related note aliases when the model omits generic title words', () => {
        const result = buildDiscoveryResultFromFindings([{
            text: 'The golden smoke note and the provider English note both skip rollback plans.',
            sourceFile: 'pagelet-smoke-golden.md',
            sourceTitle: 'Pagelet Smoke Golden',
            category: 'connection',
        }], 'pagelet-smoke-golden.md', [
            { path: 'pagelet-smoke-cancel.md' },
            { path: 'pagelet-provider-en.md' },
        ]);

        expect(result.connections[0]?.toNote).toBe('pagelet-provider-en.md');
    });

    it('maps provider Chinese aliases to zh fixture paths', () => {
        const result = buildDiscoveryResultFromFindings([{
            text: 'The current note and Pagelet Provider Chinese both omit explicit acceptance criteria.',
            sourceFile: 'pagelet-smoke-golden.md',
            sourceTitle: 'Pagelet Smoke Golden',
            category: 'connection',
        }], 'pagelet-smoke-golden.md', [
            { path: 'pagelet-provider-en.md' },
            { path: 'pagelet-provider-zh.md' },
        ]);

        expect(result.connections[0]?.toNote).toBe('pagelet-provider-zh.md');
    });

    it('matches CJK note titles via substring instead of word boundary', () => {
        const result = buildDiscoveryResultFromFindings([{
            text: '当前笔记和项目管理文档都缺少明确的验收标准。',
            sourceFile: '我的研究.md',
            sourceTitle: '我的研究',
            category: 'connection',
        }], '我的研究.md', [
            { path: '项目管理.md' },
            { path: '数据分析.md' },
        ]);

        expect(result.connections[0]?.toNote).toBe('项目管理.md');
    });

    it('does not false-match on common English substrings', () => {
        const result = buildDiscoveryResultFromFindings([{
            text: 'Both notes discuss data cancellation and testing procedures.',
            sourceFile: 'my-research.md',
            sourceTitle: 'My Research',
            category: 'connection',
        }], 'my-research.md', [
            { path: 'data-analysis.md' },
            { path: 'test-plan.md' },
        ]);

        expect(result.connections[0]?.toNote).toBe('data-analysis.md');
    });

    it('prefers the note with more unique matching terms', () => {
        const result = buildDiscoveryResultFromFindings([{
            text: 'The API design patterns document covers REST conventions.',
            sourceFile: 'overview.md',
            sourceTitle: 'Overview',
            category: 'connection',
        }], 'overview.md', [
            { path: 'api-design-patterns.md' },
            { path: 'api-reference.md' },
        ]);

        expect(result.connections[0]?.toNote).toBe('api-design-patterns.md');
    });
});
