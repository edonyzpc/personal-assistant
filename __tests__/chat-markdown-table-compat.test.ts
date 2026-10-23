import { describe, expect, it, jest } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
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

    it('preserves a large unclosed reference title without blocking (GHSA-gfr2-rv44-r23c)', () => {
        // Run the real entry point outside Jest so a vulnerable synchronous parser
        // cannot hang the suite. The limit allows ample time for normal parsing.
        const output = execFileSync(process.execPath, ['-e', String.raw`
            const assert = require('node:assert/strict');
            const { readFileSync } = require('node:fs');
            const ts = require('typescript');
            const modulePath = process.argv[1];
            const compiled = ts.transpileModule(readFileSync(modulePath, 'utf8'), {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    esModuleInterop: true,
                },
            }).outputText;
            const actualModule = { exports: {} };
            new Function('require', 'module', 'exports', compiled)(
                require, actualModule, actualModule.exports,
            );
            const source = '[a]: /u "' + 'x\n'.repeat(400_000) + '|-';
            assert.equal(actualModule.exports.prepareChatMarkdownForDisplay(source), source);
            process.stdout.write('parsed');
        `, resolve(__dirname, '../src/chat/markdown-table-compat.ts')], {
            encoding: 'utf8',
            timeout: 10_000,
            killSignal: 'SIGKILL',
        });

        expect(output).toBe('parsed');
    }, 15_000);

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
