import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Component, MarkdownRenderer, type App } from 'obsidian';
import { renderMarkdownWithOwner } from '../src/chat/mermaid';

jest.mock('obsidian');

const mermaidTrustKey = 'mermaid-vault-trust';

function createApp(options: {
    trusted?: boolean | null;
    order?: string[];
    saveError?: Error;
} = {}) {
    let trusted = options.trusted ?? null;
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
});
