import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownRenderer } from 'obsidian';
import RecordList from '../src/components/RecordList';

jest.mock('obsidian');

const { JSDOM } = require('jsdom') as {
    JSDOM: new (html: string, options: { url: string }) => {
        window: Window & { HTMLElement: typeof HTMLElement; close(): void };
    };
};

describe('RecordList asynchronous Markdown ownership', () => {
    let dom: InstanceType<typeof JSDOM>;
    const globals = globalThis as unknown as Record<string, unknown>;
    const originals = new Map<string, PropertyDescriptor | undefined>();

    beforeEach(() => {
        dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://localhost/' });
        Object.defineProperty(dom.window.document, 'win', { value: dom.window });
        Object.assign(dom.window, { createDiv: () => dom.window.document.createElement('div') });
        for (const key of ['window', 'self', 'document', 'navigator', 'Element', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) {
            originals.set(key, Object.getOwnPropertyDescriptor(globals, key));
            Object.defineProperty(globals, key, {
                configurable: true, writable: true,
                value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as unknown as Record<string, unknown>)[key],
            });
        }
        Object.assign(dom.window.HTMLElement.prototype, { empty(this: HTMLElement) { this.replaceChildren(); } });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globals, key, descriptor);
            else delete globals[key];
        }
        originals.clear();
        dom.window.close();
    });

    it.each(['replace', 'unmount'] as const)('retires a late render after %s without publishing stale content or retaining its resources', async (action) => {
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => { release = resolve; });
        const retired = jest.fn();
        const render = jest.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, markdown, element, source, owner) => {
            if (source === 'old.md') {
                await waiting;
                owner.register(retired);
            }
            element.textContent = markdown;
        });
        const app = { vault: { adapter: { read: jest.fn(async (path: string) => path) }, getName: () => 'test' } };
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        let mounted = true;
        try {
            await act(async () => root.render(<RecordList app={app as never} fileNames={['old.md']} />));
            expect(render).toHaveBeenCalledTimes(1);
            if (action === 'replace') {
                await act(async () => root.render(<RecordList app={app as never} fileNames={['new.md']} />));
                expect(container.textContent).toBe('new.md');
            } else {
                await act(async () => root.unmount());
                mounted = false;
            }
            await act(async () => { release(); await waiting; });
            expect(container.textContent).toBe(action === 'replace' ? 'new.md' : '');
            expect(retired).toHaveBeenCalledTimes(1);
        } finally {
            release();
            if (mounted) await act(async () => root.unmount());
            container.remove();
        }
    });
});
