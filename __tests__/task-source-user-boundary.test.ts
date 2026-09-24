import { extractTaskSourcePathMentions } from '../src/ai-services/task-source-user-boundary';

describe('literal task-source path discovery', () => {
    it('discovers exact paths for Host identity lookup without assigning permission', () => {
        expect(extractTaskSourcePathMentions('比较 `notes/one report.md` 与 notes/two.md，不要读取第三篇'))
            .toEqual(['notes/one report.md', 'notes/two.md']);
    });

    it('does not classify ordinary source intent or quoted wording as a boundary', () => {
        expect(extractTaskSourcePathMentions('只用当前笔记和它链接的复盘')).toEqual([]);
        expect(extractTaskSourcePathMentions('解释“只用当前笔记”这句话')).toEqual([]);
        expect(extractTaskSourcePathMentions('Use only this note and its linked report')).toEqual([]);
    });

    it('deduplicates literal paths', () => {
        expect(extractTaskSourcePathMentions('`notes/a.md` 与 notes/a.md')).toEqual(['notes/a.md']);
    });
});
