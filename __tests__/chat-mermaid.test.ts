import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Component, MarkdownRenderer, type App } from 'obsidian';
import { renderMarkdownWithOwner } from '../src/chat/mermaid';

jest.mock('obsidian');

const mermaidTrustKey = 'mermaid-vault-trust';

function createApp(options: {
    trusted?: boolean | null;
    order?: string[];
    saveError?: Error;
    lineBreakSetting?: unknown;
} = {}) {
    let trusted = options.trusted ?? null;
    const lineBreakSetting = 'lineBreakSetting' in options ? options.lineBreakSetting : false;
    return {
        loadLocalStorage: jest.fn(() => {
            options.order?.push('load');
            return trusted;
        }),
        saveLocalStorage: jest.fn((_key: string, value: boolean | null) => {
            if (options.saveError) throw options.saveError;
            options.order?.push('write');
            trusted = value;
        }),
        workspace: {
            trigger: jest.fn(() => {
                options.order?.push('event');
            }),
        },
        vault: {
            getConfig: jest.fn(() => lineBreakSetting),
        },
    } as unknown as App;
}

function createTarget(): HTMLElement {
    return {} as HTMLElement;
}

describe('Chat Mermaid native trust', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('enables host trust once before rendering, repeats no write, and re-enables after the user turns it off', async () => {
        const order: string[] = [];
        const app = createApp({ order });
        const nativeRender = MarkdownRenderer.render as unknown as jest.Mock;
        nativeRender.mockImplementation(() => {
            order.push('render');
        });
        const owner = new Component();
        const markdown = [
            '```mermaid',
            'graph TD',
            'A --> B',
            '```',
            '',
            '~~~mermaid',
            'graph TD',
            'B --> C',
            '~~~',
        ].join('\n');

        await renderMarkdownWithOwner({ app }, markdown, createTarget(), owner);

        expect(order).toEqual(['load', 'write', 'event', 'render']);
        expect(app.loadLocalStorage).toHaveBeenCalledWith(mermaidTrustKey);
        expect(app.saveLocalStorage).toHaveBeenCalledTimes(1);
        expect(app.saveLocalStorage).toHaveBeenCalledWith(mermaidTrustKey, true);
        expect(app.workspace.trigger).toHaveBeenCalledTimes(1);
        expect(app.workspace.trigger).toHaveBeenCalledWith('post-processor-change');

        await renderMarkdownWithOwner({ app }, markdown, createTarget(), owner);

        expect(order).toEqual(['load', 'write', 'event', 'render', 'load', 'render']);
        expect(app.saveLocalStorage).toHaveBeenCalledTimes(1);
        expect(app.workspace.trigger).toHaveBeenCalledTimes(1);

        (app.loadLocalStorage as jest.Mock).mockReturnValue(false);
        await renderMarkdownWithOwner({ app }, markdown, createTarget(), owner);

        expect(order.slice(-3)).toEqual(['write', 'event', 'render']);
        expect(app.saveLocalStorage).toHaveBeenCalledTimes(2);
        expect(app.workspace.trigger).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['backtick fence', '```Mermaid\ngraph TD\nA --> B\n```'],
        ['tilde fence', '~~~mermaid\ngraph TD\nA --> B\n~~~'],
        ['block quote', '> ```mermaid\n> graph TD\n> A --> B\n> ```'],
        ['list item', '- ```mermaid\n  graph TD\n  A --> B\n  ```'],
    ])('enables host trust for a Mermaid fence in %s', async (_name, markdown) => {
        const app = createApp();

        await renderMarkdownWithOwner({ app }, markdown, createTarget(), new Component());

        expect(app.saveLocalStorage).toHaveBeenCalledWith(mermaidTrustKey, true);
        expect(app.workspace.trigger).toHaveBeenCalledWith('post-processor-change');
    });

    it.each([
        ['ordinary text', 'A note that mentions Mermaid but has no fence.'],
        ['outer code example', '````markdown\n```mermaid\ngraph TD\nA --> B\n```\n````'],
        ['HTML block', '<div>\n```mermaid\ngraph TD\nA --> B\n```\n</div>'],
        ['degraded text fence', '```text\n```mermaid\ngraph TD\nA --> B\n```'],
    ])('does not enable host trust for %s', async (_name, markdown) => {
        const app = createApp();

        await renderMarkdownWithOwner({ app }, markdown, createTarget(), new Component());

        expect(app.saveLocalStorage).not.toHaveBeenCalled();
        expect(app.workspace.trigger).not.toHaveBeenCalled();
    });

    it('rejects through the existing owner render path when storage throws', async () => {
        const app = createApp({ saveError: new Error('storage unavailable') });
        const nativeRender = MarkdownRenderer.render as unknown as jest.Mock;

        await expect(renderMarkdownWithOwner(
            { app },
            '```mermaid\ngraph TD\nA --> B\n```',
            createTarget(),
            new Component(),
        )).rejects.toThrow('storage unavailable');

        expect(app.workspace.trigger).not.toHaveBeenCalled();
        expect(nativeRender).not.toHaveBeenCalled();
    });

    describe('native renderer passthrough', () => {
        beforeEach(() => {
            (MarkdownRenderer.render as unknown as jest.Mock).mockReset();
        });

        it.each([false, true])('keeps the native renderer and complete literal text with strict line breaks %s', async strictLineBreaks => {
            const app = createApp({ lineBreakSetting: strictLineBreaks });
            const owner = new Component();
            const target = createTarget();
            const markdown = 'Plain words 123.45, café; next: yes!? 中文文字\r\n'.repeat(256);

            await renderMarkdownWithOwner({ app }, markdown, target, owner, 'Folder/Note.md');

            const nativeRender = MarkdownRenderer.render as unknown as jest.Mock;
            const [renderedApp, renderedMarkdown, renderedTarget, renderedSourcePath, renderedOwner] = nativeRender.mock.calls.at(-1)!;
            expect(renderedApp).toBe(app);
            expect(renderedTarget).toBe(target);
            expect(renderedSourcePath).toBe('Folder/Note.md');
            expect(renderedOwner).toBe(owner);
            expect(renderedMarkdown).toMatch(/^<p>Plain words /);
            expect(renderedMarkdown).toMatch(/中文文字<\/p>$/);
            expect(String(renderedMarkdown).includes('<br>')).toBe(!strictLineBreaks);
            expect(String(renderedMarkdown).slice(3, -4).replace(/<br>\n/g, '\n'))
                .toBe(markdown.replace(/\r\n/g, '\n').slice(0, -1));
        });

        it.each([
            ['short paragraph', 'First line.\nSecond line.\n'],
            ['one long line', 'Long literal sentence. '.repeat(512).trimEnd()],
            ['multiple paragraphs', '\nSecond paragraph.\n'],
            ['numbered list', '1. Numbered item.\n'],
            ['empty numbered item', '2.\nFollowing text.\n'],
            ['indentation', ' Indented line.\n'],
            ['hard break', 'Two spaces.  \nNext line.\n'],
            ['trailing whitespace', 'Trailing space. \n'],
            ['bare URL', 'www.example.com\n'],
            ['email', 'person@example.com\n'],
            ['Markdown emphasis', '*emphasis*\n'],
            ['Markdown link', '[label](https://example.com)\n'],
            ['HTML/entity', '<span>HTML</span> &amp; text\n'],
            ['Mermaid', '```mermaid\ngraph TD\nA --> B\n```\n'],
            ['lone carriage return', 'First\rSecond\n'],
        ])('preserves original native Markdown input for %s', async (name, suffix) => {
            const app = createApp({ lineBreakSetting: false });
            const owner = new Component();
            const target = createTarget();
            const markdown = name === 'short paragraph' || name === 'one long line'
                ? suffix : 'Ordinary paragraph text.\n'.repeat(400) + suffix;

            await renderMarkdownWithOwner({ app }, markdown, target, owner);

            const nativeRender = MarkdownRenderer.render as unknown as jest.Mock;
            expect(nativeRender.mock.calls.at(-1)?.[1]).toBe(markdown);
        });

        it.each([undefined, 'false'])('keeps native Markdown when the line-break setting is unknown (%s)', async setting => {
            const app = createApp({ lineBreakSetting: setting });
            const owner = new Component();
            const target = createTarget();
            const markdown = 'Ordinary paragraph text.\n'.repeat(400);

            await renderMarkdownWithOwner({ app }, markdown, target, owner);

            const nativeRender = MarkdownRenderer.render as unknown as jest.Mock;
            expect(nativeRender.mock.calls.at(-1)?.[1]).toBe(markdown);
        });
    });
});
