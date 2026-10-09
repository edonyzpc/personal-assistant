import { getTagColor, normalizeTagName } from '../src/tag-appearance/palette';

describe('tag appearance palette', () => {
    test.each([
        ['Topic', 'blue'],
        ['topic', 'blue'],
        ['#Topic', 'blue'],
        ['项目', 'orange'],
        ['项目/工作', 'brown'],
        ['生活/工作', 'purple'],
        ['😀/Topic', 'pink'],
        ['é', 'gray'],
        ['e\u0301', 'orange'],
    ])('keeps the fixed UTF-8 color vector for %s', (name, expected) => {
        expect(getTagColor(name)).toBe(expected);
    });

    test('normalizes the optional prefix and case without changing hierarchy', () => {
        expect(normalizeTagName('#Topic/项目/WORK')).toBe('topic/项目/work');
        expect(normalizeTagName('项目/工作')).toBe('项目/工作');
        expect(normalizeTagName('##Topic')).toBe('#topic');
    });

    test('preserves distinct Unicode spellings instead of normalizing their identity', () => {
        expect(normalizeTagName('#É')).toBe('é');
        expect(normalizeTagName('#E\u0301')).toBe('e\u0301');
        expect(normalizeTagName('😀/Topic')).toBe('😀/topic');
    });

    test('does not depend on enumeration order or other tag names', () => {
        const names = ['Topic', '项目', '项目/工作', '生活/工作'];
        const expected = ['blue', 'orange', 'brown', 'purple'];
        expect(names.map(getTagColor)).toEqual(expected);
        getTagColor('unrelated/new-tag');
        expect([...names].reverse().map(getTagColor)).toEqual([...expected].reverse());
        expect(getTagColor('Topic')).toBe('blue');
    });

    test('allows collisions and computes a renamed tag from its new key', () => {
        expect(getTagColor('项目')).toBe('orange');
        expect(getTagColor('tag0')).toBe('orange');
        expect(getTagColor('Renamed')).toBe('pink');
        expect(getTagColor('Topic')).toBe('blue');
    });
});
