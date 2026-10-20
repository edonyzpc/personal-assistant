import { beforeEach, afterEach, describe, expect, it, afterAll, jest } from '@jest/globals';
import { Component } from 'obsidian';
import { NativeMarkdownBridge, type NativeMarkdownInput } from '../src/ui/native-markdown-bridge';

jest.mock('obsidian');

type JSDOMLike = {
    window: Window & typeof globalThis & { close(): void };
};

const { JSDOM } = require('jsdom') as {
    JSDOM: new (html?: string, options?: { url: string }) => JSDOMLike;
};

interface ControlledRender {
    input: NativeMarkdownInput;
    buffer: HTMLElement;
    owner: Component;
    resolve(): void;
    reject(error: unknown): void;
}

interface Harness {
    host: HTMLElement;
    bridge: NativeMarkdownBridge;
    renderCalls: ControlledRender[];
    published: NativeMarkdownInput[];
    ownerLoads: number;
    ownerUnloads: number;
    current: boolean;
    allowFallback: boolean;
    renderError(error: unknown, buffer: HTMLElement): void;
}

function input(content: string, overrides: Partial<NativeMarkdownInput> = {}): NativeMarkdownInput {
    return {
        content,
        sourcePath: 'notes/current.md',
        mode: 'full',
        deferMermaid: false,
        ...overrides,
    };
}

function createHarness(dom: JSDOMLike, attachStaging = false): Harness {
    const host = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(host);
    const renderCalls: ControlledRender[] = [];
    const published: NativeMarkdownInput[] = [];
    const harness: Harness = {
        host,
        bridge: null as unknown as NativeMarkdownBridge,
        renderCalls,
        published,
        ownerLoads: 0,
        ownerUnloads: 0,
        current: true,
        allowFallback: false,
        renderError(error, buffer) {
            buffer.textContent = `render failed: ${String(error)}`;
        },
    };
    harness.bridge = new NativeMarkdownBridge(host, dom.window.document, {
        createOwner() {
            const owner = new Component();
            owner.load();
            harness.ownerLoads += 1;
            return owner;
        },
        unloadOwner(owner) {
            if (!owner) return;
            owner.unload();
            harness.ownerUnloads += 1;
        },
        createBuffer: () => dom.window.document.createElement('div'),
        prepare(nextInput, phase) {
            return {
                input: nextInput,
                markdown: phase === 'error' ? '' : nextInput.content,
                mermaidSources: [],
                deferred: nextInput.deferMermaid,
                attachStaging,
                phase,
            };
        },
        render(prepared, buffer, owner) {
            return new Promise<void>((resolve, reject) => {
                renderCalls.push({
                    input: prepared.input,
                    buffer,
                    owner: owner!,
                    resolve() {
                        buffer.textContent = prepared.input.content;
                        resolve();
                    },
                    reject,
                });
            });
        },
        renderError(prepared, buffer, error) {
            harness.renderError(error, buffer);
        },
        shouldFallback: nextInput => harness.allowFallback,
        canPublish: () => harness.current,
        onPublish(prepared) {
            published.push(prepared.input);
        },
    }, 0);
    return harness;
}

async function flushAsync(times = 4): Promise<void> {
    for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe('NativeMarkdownBridge state machine', () => {
    let dom: JSDOMLike;
    const target = globalThis as unknown as Record<string, unknown>;
    const originalWindow = target.window;
    const originalDocument = target.document;

    beforeEach(() => {
        dom = new JSDOM('<main></main>', { url: 'https://pa.local/test' });
        target.window = dom.window;
        target.document = dom.window.document;
    });

    afterEach(() => dom.window.close());

    afterAll(() => {
        target.window = originalWindow;
        target.document = originalDocument;
    });

    it('keeps live content during held or hidden completion, then shows only the latest input', async () => {
        const harness = createHarness(dom);
        void harness.bridge.request(input('A'));
        harness.renderCalls[0]!.resolve();
        await flushAsync();
        expect(harness.host.textContent).toBe('A');

        void harness.bridge.request(input('B'));
        harness.host.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
        harness.renderCalls[1]!.resolve();
        await flushAsync();
        expect(harness.host.textContent).toBe('A');

        void harness.bridge.request(input('C'));
        harness.bridge.showLatest();
        harness.renderCalls[2]!.resolve();
        await flushAsync();
        expect(harness.renderCalls.map(call => call.input.content)).toEqual(['A', 'B', 'C']);
        expect(harness.host.textContent).toBe('C');
        expect(harness.published.map(nextInput => nextInput.content)).toEqual(['A', 'C']);

        await expect(harness.bridge.request(input('C'))).resolves.toBe(true);
        expect(harness.renderCalls).toHaveLength(3);
        void harness.bridge.request(input('C', { mode: 'deferred-mermaid', deferMermaid: true }));
        harness.renderCalls[3]!.resolve();
        await flushAsync();
        expect(harness.renderCalls[3]!.input.mode).toBe('deferred-mermaid');
        expect(harness.renderCalls).toHaveLength(4);
    });

    it('continues the latest non-append input after an older in-flight result is discarded', async () => {
        const harness = createHarness(dom);
        void harness.bridge.request(input('old'));
        void harness.bridge.request(input('new'));
        harness.renderCalls[0]!.resolve();
        await flushAsync();
        harness.renderCalls[1]!.resolve();
        await flushAsync();
        expect(harness.host.textContent).toBe('new');
        expect(harness.renderCalls.map(call => call.input.content)).toEqual(['old', 'new']);
    });

    it('treats native render failure as a local display result and allows the next request', async () => {
        const harness = createHarness(dom);
        const first = harness.bridge.request(input('broken'));
        harness.renderCalls[0]!.reject(new Error('native renderer failed'));
        await expect(first).resolves.toBe(true);
        expect(harness.host.textContent).toContain('native renderer failed');

        void harness.bridge.request(input('next'));
        harness.renderCalls[1]!.resolve();
        await flushAsync();
        expect(harness.host.textContent).toBe('next');
    });

    it('keeps attached Mermaid staging inaccessible until legal publication', async () => {
        const harness = createHarness(dom, true);
        void harness.bridge.request(input('live A'));
        harness.renderCalls[0]!.resolve();
        await flushAsync();
        const live = harness.host.querySelector('.message-render-buffer');
        expect(live?.textContent).toBe('live A');

        void harness.bridge.request(input('staged B'));
        const staging = harness.renderCalls[1]!.buffer;
        expect(staging.parentElement).toBe(harness.host);
        expect(staging.getAttribute('aria-hidden')).toBe('true');
        expect(staging.hidden).toBe(false);
        expect(staging.inert).toBe(true);

        harness.host.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
        harness.renderCalls[1]!.resolve();
        await flushAsync();
        expect(harness.host.textContent).toBe('live A');
        expect(staging.parentElement).toBe(null);
    });

    it('marks held from summary focus and a selection inside the host', async () => {
        const harness = createHarness(dom);
        const summary = dom.window.document.createElement('summary');
        summary.textContent = 'details';
        harness.host.appendChild(summary);
        summary.dispatchEvent(new dom.window.Event('focusin', { bubbles: true }));
        expect(harness.bridge.getState().held).toBe(true);
        harness.bridge.showLatest();
        expect(harness.bridge.getState().held).toBe(false);

        const text = dom.window.document.createElement('span');
        text.textContent = 'selected';
        harness.host.appendChild(text);
        const range = dom.window.document.createRange();
        range.selectNodeContents(text);
        const selection = dom.window.document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        dom.window.document.dispatchEvent(new dom.window.Event('selectionchange'));
        expect(harness.bridge.getState().held).toBe(true);
    });

    it('holds a middle message fully contained by a selection across messages', () => {
        const before = dom.window.document.createElement('p');
        before.textContent = 'before';
        dom.window.document.body.appendChild(before);
        const harness = createHarness(dom);
        harness.host.textContent = 'middle';
        const after = dom.window.document.createElement('p');
        after.textContent = 'after';
        dom.window.document.body.appendChild(after);
        const range = dom.window.document.createRange();
        range.setStart(before.firstChild!, 1);
        range.setEnd(after.firstChild!, 2);
        dom.window.document.getSelection()!.addRange(range);
        dom.window.document.dispatchEvent(new dom.window.Event('selectionchange'));
        expect(harness.bridge.getState().held).toBe(true);
    });

    it('pauses, resumes, closes and isolates two native hosts independently', async () => {
        const first = createHarness(dom);
        const second = createHarness(dom);
        first.bridge.setDisplayPaused('view', true);
        await expect(first.bridge.request(input('hidden'))).resolves.toBe(true);
        expect(first.renderCalls).toHaveLength(0);

        void second.bridge.request(input('visible'));
        second.renderCalls[0]!.resolve();
        await flushAsync();
        expect(second.host.textContent).toBe('visible');

        first.bridge.setDisplayPaused('view', false);
        first.renderCalls[0]!.resolve();
        await flushAsync();
        expect(first.renderCalls.map(call => call.input.content)).toEqual(['hidden']);
        expect(first.host.textContent).toBe('hidden');

        first.bridge.dispose();
        expect(first.host.childElementCount).toBe(0);
        expect(second.host.textContent).toBe('visible');
    });

    it('unloads a late-started owner once after close without unloading it early', async () => {
        const harness = createHarness(dom);
        void harness.bridge.request(input('late'));
        const ownerUnloadsBeforeClose = harness.ownerUnloads;
        harness.bridge.dispose();
        expect(harness.ownerUnloads).toBe(ownerUnloadsBeforeClose);
        harness.renderCalls[0]!.resolve();
        await flushAsync();
        expect(harness.ownerUnloads).toBe(ownerUnloadsBeforeClose + 1);
    });

    it('accepts an in-flight final display while held without waiting for its native work', async () => {
        const harness = createHarness(dom);
        let accepted = false;
        void harness.bridge.request(input('final')).then(() => { accepted = true; });
        harness.bridge.setHeld(true);
        await flushAsync();
        expect(accepted).toBe(true);
        let finalSettled = false;
        void harness.bridge.settleBeforeFinal(input('final')).then(() => { finalSettled = true; });
        await flushAsync();
        expect(finalSettled).toBe(true);
        harness.bridge.showLatest();
        harness.renderCalls[0]!.resolve();
        await flushAsync();
        expect(harness.host.textContent).toBe('final');
        expect(harness.renderCalls).toHaveLength(1);
    });

    it('keeps an existing live value when it supersedes a different in-flight replacement', async () => {
        const harness = createHarness(dom);
        void harness.bridge.request(input('A'));
        harness.renderCalls[0]!.resolve();
        await flushAsync();
        void harness.bridge.request(input('B'));
        await harness.bridge.request(input('A'));
        harness.renderCalls[1]!.resolve();
        await flushAsync();
        expect(harness.host.textContent).toBe('A');
        expect(harness.published.map(value => value.content)).toEqual(['A']);
    });

    it('does not publish an older append that crosses a pause when a newer value is waiting', async () => {
        const harness = createHarness(dom);
        void harness.bridge.request(input('A'));
        harness.renderCalls[0]!.resolve();
        await flushAsync();
        void harness.bridge.request(input('AB'));
        harness.bridge.setDisplayPaused('view', true);
        void harness.bridge.request(input('ABC'));
        harness.bridge.setDisplayPaused('view', false);
        void harness.bridge.request(input('ABCD'));
        harness.renderCalls[1]!.resolve();
        await flushAsync();
        expect(harness.host.textContent).toBe('A');
        harness.renderCalls[2]!.resolve();
        await flushAsync();
        expect(harness.published.map(value => value.content)).toEqual(['A', 'ABCD']);
    });

    it('releases primary and fallback owners and rejects revoked work even while paused', async () => {
        const harness = createHarness(dom, true);
        harness.allowFallback = true;
        const result = harness.bridge.request(input('diagram'));
        harness.renderCalls[0]!.reject(new Error('primary failed'));
        await flushAsync();
        harness.bridge.setDisplayPaused('view', true);
        harness.current = false;
        harness.renderCalls[1]!.reject(new Error('fallback failed'));
        await flushAsync();
        expect(harness.ownerUnloads).toBe(2);
        harness.bridge.setDisplayPaused('view', false);
        await flushAsync();
        expect(harness.renderCalls).toHaveLength(2);
        expect(harness.host.childElementCount).toBe(0);
        await result;
    });
});
