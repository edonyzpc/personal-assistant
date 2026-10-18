import { describe, expect, it, jest } from '@jest/globals';
import MarkdownIt from 'markdown-it';
import { prepareChatMarkdownForDisplay } from '../src/chat/markdown-table-compat';

jest.mock('markdown-it', () => {
    const ActualMarkdownIt = jest.requireActual('markdown-it') as unknown as
        new (...arguments_: unknown[]) => ReturnType<typeof MarkdownIt>;
    const MarkdownItMock = jest.fn((...arguments_: unknown[]) => new ActualMarkdownIt(...arguments_));
    return { __esModule: true, default: MarkdownItMock };
});

describe('Chat Markdown table display compatibility', () => {
    it('returns a cheap non-candidate without initializing the block parser', () => {
        const markdownItConstructor = MarkdownIt as unknown as jest.Mock;
        const source = 'Plain text\nwith a pipe | but no separator';

        expect(prepareChatMarkdownForDisplay(source)).toBe(source);
        expect(markdownItConstructor).not.toHaveBeenCalled();
    });

    it('inserts one blank line between a top-level paragraph and a valid table', () => {
        const source = 'Comparison:\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |';
        const expected = 'Comparison:\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |';

        expect(prepareChatMarkdownForDisplay(source)).toBe(expected);
    });

    it('preserves CRLF line endings when inserting the display boundary', () => {
        const source = 'Comparison:\r\n| Name | Value |\r\n| --- | --- |\r\n| Alpha | 1 |';
        const expected = 'Comparison:\r\n\r\n| Name | Value |\r\n| --- | --- |\r\n| Alpha | 1 |';

        expect(prepareChatMarkdownForDisplay(source)).toBe(expected);
    });

    it('passes mixed unpaired CR and LF input through unchanged', () => {
        const source = 'Intro\rSecond\n| A | B |\n|---|---|\n| x | y |';

        expect(prepareChatMarkdownForDisplay(source)).toBe(source);
    });

    it('inserts boundaries for multiple tables without changing existing blank lines', () => {
        const source = [
            'First:',
            '| A | B |',
            '| --- | --- |',
            '| 1 | 2 |',
            '',
            'Second:',
            '| C | D |',
            '| --- | --- |',
            '| 3 | 4 |',
        ].join('\n');
        const expected = [
            'First:',
            '',
            '| A | B |',
            '| --- | --- |',
            '| 1 | 2 |',
            '',
            'Second:',
            '',
            '| C | D |',
            '| --- | --- |',
            '| 3 | 4 |',
        ].join('\n');

        expect(prepareChatMarkdownForDisplay(source)).toBe(expected);
        expect(prepareChatMarkdownForDisplay(expected)).toBe(expected);
    });

    it('recognizes escaped pipes in table data cells', () => {
        const source = 'Comparison:\n| Name | Value |\n| --- | --- |\n| Alpha \\| Beta | 1 |';
        const expected = 'Comparison:\n\n| Name | Value |\n| --- | --- |\n| Alpha \\| Beta | 1 |';

        expect(prepareChatMarkdownForDisplay(source)).toBe(expected);
    });

    it.each([
        ['already separated table', 'Text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'],
        ['fenced code', 'Text\n```text\n| A | B |\n| --- | --- |\n```'],
        ['indented code', 'Text\n\n    | A | B |\n    | --- | --- |'],
        ['raw HTML block', 'Text\n<div>\n| A | B |\n| --- | --- |\n</div>'],
        ['blockquote', '> Text\n> | A | B |\n> | --- | --- |'],
        ['list', '- Text\n  | A | B |\n  | --- | --- |'],
        ['ordinary pipes', 'Text\nA | B - C'],
        ['invalid separator', 'Text\n| A | B |\n| ---x | --- |\n| 1 | 2 |'],
    ])('passes %s through unchanged', (_name, source) => {
        expect(prepareChatMarkdownForDisplay(source)).toBe(source);
    });
});
