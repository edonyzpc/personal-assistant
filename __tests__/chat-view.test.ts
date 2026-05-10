import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MarkdownRenderer, MarkdownView } from 'obsidian';
import type { ChatAgentStatus, StreamLLMOptions } from '../src/ai-services/chat-service';
import { LLMView } from '../src/chat-view';

jest.mock('obsidian');

type StreamCall = {
    prompt: string;
    onChunk: (chunk: string) => void;
    signal?: AbortSignal;
    chatHistory?: unknown[];
    options: StreamLLMOptions;
    resolve: () => void;
    reject: (error: unknown) => void;
};

type AnimationFrameCall = {
    id: number;
    callback: FrameRequestCallback;
    cancelled: boolean;
};

const mockStreamLLM = jest.fn<(
    prompt: string,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
    chatHistory?: unknown[],
    options?: StreamLLMOptions,
) => Promise<void>>();

jest.mock('../src/ai-services/chat-service', () => ({
    ChatService: jest.fn().mockImplementation(() => ({
        streamLLM: mockStreamLLM,
    })),
}));

jest.mock('../src/utils', () => ({
    isPluginEnabled: jest.fn(() => false),
}));

type ClassInput = string | string[];
type CreateOptions = ClassInput | {
    cls?: ClassInput;
    text?: string;
    attr?: Record<string, string>;
};

class MockClassList {
    private classes = new Set<string>();

    add(...tokens: string[]) {
        for (const token of tokens) {
            for (const className of token.split(/\s+/).filter(Boolean)) {
                this.classes.add(className);
            }
        }
    }

    remove(...tokens: string[]) {
        for (const token of tokens) {
            for (const className of token.split(/\s+/).filter(Boolean)) {
                this.classes.delete(className);
            }
        }
    }

    replace(oldToken: string, newToken: string) {
        if (!this.classes.has(oldToken)) return false;
        this.classes.delete(oldToken);
        this.classes.add(newToken);
        return true;
    }

    contains(token: string) {
        return this.classes.has(token);
    }
}

class MockElement {
    readonly tagName: string;
    readonly classList = new MockClassList();
    readonly children: MockElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, Array<(event: unknown) => void>>();
    parentElement: MockElement | null = null;
    textContent = '';
    private _value = '';
    disabled = false;
    hidden = false;
    scrollHeight = 120;
    scrollTop = 0;
    clientWidth = 600;
    clientHeight = 80;
    id = '';
    readonly scrollToCalls: Array<{ top?: number; behavior?: ScrollBehavior }> = [];
    href = '';
    onclick: ((event: { stopPropagation: () => void; preventDefault: () => void }) => void | Promise<void>) | null = null;
    onkeydown: ((event: { key: string; preventDefault: () => void }) => void) | null = null;

    constructor(tagName: string) {
        this.tagName = tagName.toLowerCase();
    }

    createDiv(options?: CreateOptions) {
        return this.createChild('div', options);
    }

    createEl(tagName: string, options?: CreateOptions) {
        return this.createChild(tagName, options);
    }

    createSpan(options?: CreateOptions) {
        return this.createChild('span', options);
    }

    get value() {
        return this._value;
    }

    set value(value: string) {
        this._value = value;
        this.dispatchEvent('input');
    }

    addEventListener(type: string, listener: (event: unknown) => void) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatchEvent(type: string, event: unknown = {}) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
        if (type === 'keydown' && this.onkeydown) {
            this.onkeydown(event as { key: string; preventDefault: () => void });
        }
    }

    focus() { }

    click() {
        if (this.disabled || !this.onclick) return undefined;
        return this.onclick({
            stopPropagation: () => { },
            preventDefault: () => { },
        });
    }

    empty() {
        for (const child of this.children) {
            child.parentElement = null;
        }
        this.children.length = 0;
        this.textContent = '';
    }

    setText(text: string) {
        this.textContent = text;
    }

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }

    getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
    }

    querySelectorAll(_selector: string) {
        return [] as MockElement[];
    }

    scrollTo(options: { top?: number; behavior?: ScrollBehavior }) {
        this.scrollToCalls.push(options);
        this.scrollTop = options.top ?? this.scrollTop;
    }

    removeChild(child: MockElement) {
        const index = this.children.indexOf(child);
        if (index === -1) {
            throw new Error('Child not found');
        }
        this.children.splice(index, 1);
        child.parentElement = null;
        return child;
    }

    appendChild(child: MockElement) {
        if (child.parentElement) {
            child.parentElement.removeChild(child);
        }
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    private createChild(tagName: string, options?: CreateOptions) {
        const child = new MockElement(tagName);
        child.parentElement = this;
        this.children.push(child);
        this.applyOptions(child, options);
        return child;
    }

    private applyOptions(child: MockElement, options?: CreateOptions) {
        if (!options) return;
        if (typeof options === 'string' || Array.isArray(options)) {
            this.addClasses(child, options);
            return;
        }
        if (options.cls) this.addClasses(child, options.cls);
        if (options.text) child.textContent = options.text;
        if (options.attr) {
            for (const [name, value] of Object.entries(options.attr)) {
                child.setAttribute(name, value);
            }
        }
    }

    private addClasses(child: MockElement, input: ClassInput) {
        const values = Array.isArray(input) ? input : [input];
        child.classList.add(...values);
    }
}

function walk(root: MockElement, predicate: (el: MockElement) => boolean): MockElement | null {
    if (predicate(root)) return root;
    for (const child of root.children) {
        const found = walk(child, predicate);
        if (found) return found;
    }
    return null;
}

function walkAll(root: MockElement, predicate: (el: MockElement) => boolean, results: MockElement[] = []): MockElement[] {
    if (predicate(root)) results.push(root);
    for (const child of root.children) {
        walkAll(child, predicate, results);
    }
    return results;
}

function getTextArea(root: MockElement) {
    const textArea = walk(root, (el) => el.tagName === 'textarea');
    if (!textArea) throw new Error('textarea not found');
    return textArea;
}

function getButtonByText(root: MockElement, text: string) {
    const button = walk(root, (el) => el.tagName === 'button' && el.textContent === text);
    if (!button) throw new Error(`button not found: ${text}`);
    return button;
}

function getButtonByClass(root: MockElement, className: string) {
    const button = walk(root, (el) => el.tagName === 'button' && el.classList.contains(className));
    if (!button) throw new Error(`button not found: ${className}`);
    return button;
}

function getButtonsByClass(root: MockElement, className: string) {
    return walkAll(root, (el) => el.tagName === 'button' && el.classList.contains(className));
}

function getElementByClass(root: MockElement, className: string) {
    const element = walk(root, (el) => el.classList.contains(className));
    if (!element) throw new Error(`element not found: ${className}`);
    return element;
}

function getElementsByClass(root: MockElement, className: string) {
    return walkAll(root, (el) => el.classList.contains(className));
}

function getResponseDiv(view: LLMView) {
    return view.responseDiv as unknown as MockElement;
}

function allText(root: MockElement): string {
    return [root.textContent, ...root.children.map(allText)].join('');
}

function expectVisible(button: MockElement, visibleClass: string, hiddenClass: string) {
    expect(button.classList.contains(visibleClass)).toBe(true);
    expect(button.classList.contains(hiddenClass)).toBe(false);
}

function expectHidden(button: MockElement, visibleClass: string, hiddenClass: string) {
    expect(button.classList.contains(visibleClass)).toBe(false);
    expect(button.classList.contains(hiddenClass)).toBe(true);
}

function flushPromises() {
    return new Promise<void>((resolve) => setImmediate(resolve));
}

function createView(options: { withMarkdownLeaf?: boolean; panelWidth?: number } = {}) {
    const containerEl = new MockElement('div');
    containerEl.clientWidth = options.panelWidth ?? 600;
    const editor = {
        getCursor: jest.fn(() => ({ line: 0, ch: 0 })),
        replaceRange: jest.fn(),
    };
    const markdownLeaf = {
        view: new MarkdownView(editor as unknown as ConstructorParameters<typeof MarkdownView>[0]),
    };
    const app = {
        workspace: {
            getMostRecentLeaf: jest.fn(() => options.withMarkdownLeaf ? markdownLeaf : null),
            getLeavesOfType: jest.fn(() => options.withMarkdownLeaf ? [markdownLeaf] : []),
            setActiveLeaf: jest.fn(),
        },
        vault: {
            getName: jest.fn(() => 'test'),
        },
    };
    const plugin = {
        app,
        showTechnicalMemoryStatus: jest.fn(async () => undefined),
    };
    const leaf = { app, containerEl };
    const view = new LLMView(
        leaf as unknown as ConstructorParameters<typeof LLMView>[0],
        plugin as unknown as ConstructorParameters<typeof LLMView>[1],
        {} as unknown as ConstructorParameters<typeof LLMView>[2],
    );
    return { view, containerEl, app, plugin, editor };
}

describe('LLMView turn lifecycle', () => {
    let streamCalls: StreamCall[];
    let animationFrames: AnimationFrameCall[];
    let nextAnimationFrameId: number;

    function runAnimationFrames(includeCancelled = false) {
        const frames = [...animationFrames];
        animationFrames = [];
        for (const frame of frames) {
            if (!includeCancelled && frame.cancelled) continue;
            frame.callback(frame.id);
        }
    }

    beforeEach(() => {
        streamCalls = [];
        animationFrames = [];
        nextAnimationFrameId = 1;
        mockStreamLLM.mockReset();
        (MarkdownRenderer.render as jest.Mock).mockClear();
        (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
            el.setText(markdown);
        });
        mockStreamLLM.mockImplementation((prompt, onChunk, signal, chatHistory, options = {}) => {
            return new Promise<void>((resolve, reject) => {
                streamCalls.push({ prompt, onChunk, signal, chatHistory, options, resolve, reject });
            });
        });

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
                    const id = nextAnimationFrameId;
                    nextAnimationFrameId += 1;
                    animationFrames.push({ id, callback, cancelled: false });
                    return id;
                }),
                cancelAnimationFrame: jest.fn((id: number) => {
                    const frame = animationFrames.find((candidate) => candidate.id === id);
                    if (frame) frame.cancelled = true;
                }),
            },
        });
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: undefined,
        });
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                clipboard: {
                    writeText: jest.fn(async () => undefined),
                },
            },
        });
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: undefined,
        });
    });

    it('aborts and ignores stale stream callbacks when the chat is cleared', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'write a long answer';
        const askButton = getButtonByText(containerEl, 'Ask');
        const cancelButton = getButtonByClass(containerEl, 'cancel-button');
        void askButton.click();
        await flushPromises();

        expect(streamCalls).toHaveLength(1);
        expectHidden(askButton, 'send-button-visible', 'send-button-hidden');
        expectVisible(cancelButton, 'cancel-button-visible', 'cancel-button-hidden');
        getButtonByText(containerEl, 'Clear Chat').click();
        await flushPromises();

        const call = streamCalls[0];
        expect(call.signal?.aborted).toBe(true);
        expectVisible(askButton, 'send-button-visible', 'send-button-hidden');
        expect(askButton.disabled).toBe(true);
        expectHidden(cancelButton, 'cancel-button-visible', 'cancel-button-hidden');
        call.options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);
        call.onChunk('late chunk');
        call.reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();
        runAnimationFrames(true);

        expect(view.chatHistory).toEqual([]);
        expect(getResponseDiv(view).scrollToCalls).toEqual([]);
        expect(allText(containerEl)).not.toContain('*Generation cancelled*');
        expect(allText(containerEl)).not.toContain('late chunk');
        expect(allText(containerEl)).not.toContain('Deciding what context to use');
    });

    it('aborts and ignores stale stream callbacks after the view closes', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'write a long answer';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        expect(streamCalls).toHaveLength(1);
        await view.onClose();

        const call = streamCalls[0];
        expect(call.signal?.aborted).toBe(true);
        expect(globalThis.window.cancelAnimationFrame).toHaveBeenCalledWith(1);
        call.options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);
        call.onChunk('late chunk');
        call.reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();
        runAnimationFrames(true);

        expect(view.chatHistory).toEqual([]);
        expect(getResponseDiv(view).scrollToCalls).toEqual([]);
        expect(allText(containerEl)).not.toContain('*Generation cancelled*');
        expect(allText(containerEl)).not.toContain('late chunk');
        expect(allText(containerEl)).not.toContain('Deciding what context to use');
    });

    it('keeps the cancelled message but ignores stale chunks after cancel', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'write a long answer';
        const askButton = getButtonByText(containerEl, 'Ask');
        const cancelButton = getButtonByClass(containerEl, 'cancel-button');
        void askButton.click();
        await flushPromises();

        expect(streamCalls).toHaveLength(1);
        expectHidden(askButton, 'send-button-visible', 'send-button-hidden');
        expectVisible(cancelButton, 'cancel-button-visible', 'cancel-button-hidden');
        const call = streamCalls[0];
        cancelButton.click();

        expect(call.signal?.aborted).toBe(true);
        expectVisible(askButton, 'send-button-visible', 'send-button-hidden');
        expectHidden(cancelButton, 'cancel-button-visible', 'cancel-button-hidden');
        call.options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);
        call.onChunk('late chunk');
        call.reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(askButton.disabled).toBe(true);
        expect(allText(containerEl)).toContain('Generation cancelled');
        expect(allText(containerEl)).not.toContain('late chunk');
        expect(allText(containerEl)).not.toContain('Deciding what context to use');
    });

    it('commits successful user and assistant messages as one model-history pair', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'summarize this note';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        expect(streamCalls).toHaveLength(1);
        expect(streamCalls[0].chatHistory).toEqual([]);
        streamCalls[0].onChunk('summary answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();
        runAnimationFrames(true);

        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'summarize this note' },
            { role: 'assistant', content: 'summary answer' },
        ]);
        expect(allText(containerEl)).toContain('summarize this note');
        expect(allText(containerEl)).toContain('summary answer');

        getTextArea(containerEl).value = 'follow up';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        expect(streamCalls).toHaveLength(2);
        expect(streamCalls[1].chatHistory).toEqual([
            { role: 'user', content: 'summarize this note' },
            { role: 'assistant', content: 'summary answer' },
        ]);
        expect(streamCalls[1].chatHistory).not.toBe(view.chatHistory);
        expect(streamCalls[1].chatHistory?.[0]).not.toBe(view.chatHistory[0]);
        expect(streamCalls[1].chatHistory?.[1]).not.toBe(view.chatHistory[1]);
    });

    it('keeps failed turns out of model history and retries through the normal send path', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'try a fragile answer';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        streamCalls[0].reject(new Error('network failed'));
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).toContain('The answer did not finish.');
        getButtonByClass(containerEl, 'retry-message-button').click();
        await flushPromises();

        expect(streamCalls).toHaveLength(2);
        expect(streamCalls[1].prompt).toBe('try a fragile answer');
        expect(streamCalls[1].chatHistory).toEqual([]);
        expect(streamCalls[1].options.memoryMode).toBe('auto');
    });

    it('keeps cancelled turns retryable through the normal send path', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'cancelled prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        const call = streamCalls[0];
        getButtonByClass(containerEl, 'cancel-button').click();
        call.reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).toContain('Generation cancelled');
        getButtonByClass(containerEl, 'retry-message-button').click();
        await flushPromises();

        expect(streamCalls).toHaveLength(2);
        expect(streamCalls[1].prompt).toBe('cancelled prompt');
        expect(streamCalls[1].chatHistory).toEqual([]);
        expect(streamCalls[1].options.memoryMode).toBe('auto');
    });

    it('keeps Ask disabled while Stop is settling', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        const textArea = getTextArea(containerEl);
        textArea.value = 'first prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        textArea.value = 'draft after stop';
        const askButton = getButtonByText(containerEl, 'Ask');
        getButtonByClass(containerEl, 'cancel-button').click();

        expectVisible(askButton, 'send-button-visible', 'send-button-hidden');
        expect(askButton.disabled).toBe(true);
        askButton.click();
        expect(streamCalls).toHaveLength(1);

        streamCalls[0].reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();

        expect(askButton.disabled).toBe(false);
    });

    it('disables successful-turn delete while a newer generation is active', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'first prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('first answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        let deleteButtons = getButtonsByClass(containerEl, 'delete-message-button');
        expect(deleteButtons).toHaveLength(2);
        expect(deleteButtons.every((button) => !button.disabled)).toBe(true);

        getTextArea(containerEl).value = 'second prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        deleteButtons = getButtonsByClass(containerEl, 'delete-message-button');
        expect(deleteButtons).toHaveLength(2);
        expect(deleteButtons.every((button) => button.disabled)).toBe(true);
        deleteButtons[0].click();
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'first prompt' },
            { role: 'assistant', content: 'first answer' },
        ]);
    });

    it('deletes a successful user and assistant turn as one history pair', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'first prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('first answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const deleteButtons = getButtonsByClass(containerEl, 'delete-message-button');
        expect(deleteButtons).toHaveLength(2);
        deleteButtons[1].click();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).not.toContain('first prompt');
        expect(allText(containerEl)).not.toContain('first answer');
    });

    it('ignores stale clear and delete confirmations after the view session changes', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'first prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('first answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        getButtonsByClass(containerEl, 'delete-message-button')[0].click();
        await view.onClose();
        await flushPromises();
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'first prompt' },
            { role: 'assistant', content: 'first answer' },
        ]);

        getButtonByText(containerEl, 'Clear Chat').click();
        await view.onClose();
        await flushPromises();
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'first prompt' },
            { role: 'assistant', content: 'first answer' },
        ]);
    });

    it('keeps terminal retry rows intact when a newer generation is active', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'fragile prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].reject(new Error('network failed'));
        await flushPromises();
        await flushPromises();

        const retryButton = getButtonByClass(containerEl, 'retry-message-button');
        const deleteButton = getButtonByClass(containerEl, 'delete-message-button');
        expect(retryButton.disabled).toBe(false);
        expect(deleteButton.disabled).toBe(false);
        getTextArea(containerEl).value = 'new prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        expect(retryButton.disabled).toBe(true);
        expect(deleteButton.disabled).toBe(true);
        retryButton.click();
        deleteButton.click();
        await flushPromises();

        expect(streamCalls).toHaveLength(2);
        expect(allText(containerEl)).toContain('fragile prompt');
        expect(allText(containerEl)).toContain('The answer did not finish.');
    });

    it('keeps UI-only failed turns visible when later successful turns redraw the timeline', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'fragile prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].reject(new Error('network failed'));
        await flushPromises();
        await flushPromises();

        getTextArea(containerEl).value = 'later prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[1].onChunk('later answer');
        streamCalls[1].resolve();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'later prompt' },
            { role: 'assistant', content: 'later answer' },
        ]);
        expect(allText(containerEl)).toContain('fragile prompt');
        expect(allText(containerEl)).toContain('The answer did not finish.');
        expect(allText(containerEl)).toContain('later prompt');
        expect(allText(containerEl)).toContain('later answer');
        expect(getButtonByClass(containerEl, 'retry-message-button').disabled).toBe(false);
    });

    it('keeps UI-only failed turns visible when a successful history pair is deleted', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'fragile prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].reject(new Error('network failed'));
        await flushPromises();
        await flushPromises();

        getTextArea(containerEl).value = 'later prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[1].onChunk('later answer');
        streamCalls[1].resolve();
        await flushPromises();
        await flushPromises();

        const deleteButtons = getButtonsByClass(containerEl, 'delete-message-button');
        expect(deleteButtons).toHaveLength(3);
        deleteButtons[2].click();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).toContain('fragile prompt');
        expect(allText(containerEl)).toContain('The answer did not finish.');
        expect(allText(containerEl)).not.toContain('later prompt');
        expect(allText(containerEl)).not.toContain('later answer');
    });

    it('restores the empty state after deleting the only terminal turn', async () => {
        const { view, containerEl } = createView({ withMarkdownLeaf: true });
        await view.onOpen();

        getTextArea(containerEl).value = 'fragile prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].reject(new Error('network failed'));
        await flushPromises();
        await flushPromises();

        expect(allText(containerEl)).toContain('The answer did not finish.');
        getButtonByClass(containerEl, 'delete-message-button').click();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).toContain('Ask about your notes');
        expect(getButtonByText(containerEl, 'Summarize current note').disabled).toBe(false);
    });

    it('ignores delayed stale markdown renders after a newer stream chunk', async () => {
        const { view, containerEl } = createView();
        const renderJobs: Array<{ markdown: string; el: MockElement; resolve: () => void }> = [];
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createElement: (tagName: string) => new MockElement(tagName),
            },
        });
        (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
            return new Promise<void>((resolve) => {
                renderJobs.push({
                    markdown,
                    el,
                    resolve: () => {
                        el.setText(markdown);
                        resolve();
                    },
                });
            });
        });
        await view.onOpen();

        getTextArea(containerEl).value = 'stream';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        streamCalls[0].onChunk('old chunk');
        streamCalls[0].onChunk('new chunk');
        expect(renderJobs.map((job) => job.markdown)).toEqual(['stream', 'old chunk', 'new chunk']);

        renderJobs[1].resolve();
        await flushPromises();
        expect(allText(containerEl)).not.toContain('old chunk');

        renderJobs[2].resolve();
        await flushPromises();
        expect(allText(containerEl)).toContain('new chunk');
        expect(allText(containerEl)).not.toContain('old chunk');
    });

    it('keeps the cancelled user prompt when markdown rendering resolves after cancel', async () => {
        const { view, containerEl } = createView();
        const renderJobs: Array<{ markdown: string; el: MockElement; resolve: () => void }> = [];
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createElement: (tagName: string) => new MockElement(tagName),
            },
        });
        (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
            return new Promise<void>((resolve) => {
                renderJobs.push({
                    markdown,
                    el,
                    resolve: () => {
                        el.setText(markdown);
                        resolve();
                    },
                });
            });
        });
        await view.onOpen();

        getTextArea(containerEl).value = 'late prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        const call = streamCalls[0];
        getButtonByClass(containerEl, 'cancel-button').click();
        call.reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();

        expect(allText(containerEl)).toContain('Generation cancelled');
        expect(allText(containerEl)).not.toContain('late prompt');
        renderJobs.find((job) => job.markdown === 'late prompt')?.resolve();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).toContain('late prompt');
        expect(allText(containerEl)).toContain('Generation cancelled');
    });

    it('does not publish partial streamed content to Add to Editor after cancellation', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'partial prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        const call = streamCalls[0];
        call.onChunk('partial answer');
        expect(view.result).toBe('');
        expect(getButtonByText(containerEl, 'Add to Editor').disabled).toBe(true);
        getButtonByClass(containerEl, 'cancel-button').click();
        call.reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();

        expect(view.result).toBe('');
        expect(getButtonByText(containerEl, 'Add to Editor').disabled).toBe(true);
    });

    it('keeps Ask disabled while empty and sends with Enter only when a draft exists', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        const textArea = getTextArea(containerEl);
        const askButton = getButtonByText(containerEl, 'Ask');
        expect(askButton.disabled).toBe(true);

        textArea.value = 'keyboard prompt';
        expect(askButton.disabled).toBe(false);
        textArea.dispatchEvent('keydown', {
            key: 'Enter',
            shiftKey: true,
            preventDefault: jest.fn(),
        });
        expect(streamCalls).toHaveLength(0);

        const preventDefault = jest.fn();
        textArea.dispatchEvent('keydown', {
            key: 'Enter',
            shiftKey: false,
            preventDefault,
        });
        await flushPromises();

        expect(preventDefault).toHaveBeenCalled();
        expect(streamCalls).toHaveLength(1);
        expect(streamCalls[0].prompt).toBe('keyboard prompt');
    });

    it('keeps a draft next message during generation and shows the wait hint on Enter', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        const textArea = getTextArea(containerEl);
        textArea.value = 'first prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        textArea.value = 'next draft';
        textArea.dispatchEvent('keydown', {
            key: 'Enter',
            shiftKey: false,
            preventDefault: jest.fn(),
        });

        expect(streamCalls).toHaveLength(1);
        expect(textArea.value).toBe('next draft');
        expect(allText(containerEl)).toContain('Wait for this answer to finish or stop it first.');

        streamCalls[0].onChunk('first answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(textArea.value).toBe('next draft');
        expect(getButtonByText(containerEl, 'Ask').disabled).toBe(false);
    });

    it('renders current-note empty state chips that fill the composer without sending', async () => {
        const { view, containerEl } = createView({ withMarkdownLeaf: true });
        await view.onOpen();

        expect(allText(containerEl)).toContain('Ask about your notes');
        getButtonByText(containerEl, 'Summarize current note').click();

        expect(getTextArea(containerEl).value).toBe('Summarize the current note.');
        expect(getButtonByText(containerEl, 'Ask').disabled).toBe(false);
        expect(streamCalls).toHaveLength(0);
    });

    it('disables empty state chips when no markdown note is available', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        expect(getButtonByText(containerEl, 'Summarize current note').disabled).toBe(true);
        expect(getButtonByText(containerEl, 'Find related notes').disabled).toBe(true);
        expect(getButtonByText(containerEl, 'Draft from current note').disabled).toBe(true);
        expect(allText(containerEl)).toContain('Open a note to use this.');
    });

    it('uses panel-width density classes instead of viewport media queries', async () => {
        const { view, containerEl } = createView({ panelWidth: 340 });
        await view.onOpen();

        expect(containerEl.classList.contains('is-narrow')).toBe(true);
        expect(containerEl.classList.contains('is-compact')).toBe(true);
    });

    it('adds a specific assistant message to the editor from its message menu', async () => {
        const { view, containerEl, editor } = createView({ withMarkdownLeaf: true });
        await view.onOpen();

        getTextArea(containerEl).value = 'first prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('first answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        getTextArea(containerEl).value = 'second prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[1].onChunk('second answer');
        streamCalls[1].resolve();
        await flushPromises();
        await flushPromises();

        const addButtons = getButtonsByClass(containerEl, 'add-to-editor-message-button');
        expect(addButtons).toHaveLength(2);
        addButtons[0].click();
        await flushPromises();

        expect(editor.replaceRange).toHaveBeenCalledWith('first answer', { line: 0, ch: 0 });
    });

    it('exposes composer More menu actions and technical Memory status', async () => {
        const { view, containerEl, plugin } = createView();
        await view.onOpen();

        const moreButton = getButtonByClass(containerEl, 'pa-chat-more-button');
        const composerMenu = getElementByClass(containerEl, 'pa-chat-composer-menu');
        expect(composerMenu.hidden).toBe(true);

        moreButton.click();
        expect(composerMenu.hidden).toBe(false);
        expect(moreButton.getAttribute('aria-expanded')).toBe('true');

        getButtonByText(containerEl, 'Show technical Memory status').click();
        expect(plugin.showTechnicalMemoryStatus).toHaveBeenCalledTimes(1);
    });

    it('adds a polite live region and keyboard toggle to the activity row', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'status prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);

        const summary = getElementByClass(containerEl, 'thinking-status-summary');
        const header = getElementByClass(containerEl, 'thinking-status-header');
        const toggle = getButtonByClass(containerEl, 'thinking-status-toggle');
        const details = getElementByClass(containerEl, 'thinking-status-details');
        expect(summary.getAttribute('aria-live')).toBe('polite');
        expect(header.getAttribute('role')).toBeNull();
        expect(header.getAttribute('tabindex')).toBeNull();
        expect(toggle.getAttribute('aria-controls')).toBe(details.id);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        toggle.click();

        expect(details.hidden).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('coalesces repeated activity details and caps retained rows', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'status prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);
        streamCalls[0].options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);
        for (let index = 1; index <= 8; index += 1) {
            streamCalls[0].options.onStatus?.({
                type: 'tool-running',
                message: `Tool step ${index}`,
            } as ChatAgentStatus);
        }

        const details = getElementsByClass(containerEl, 'thinking-status-detail-item');
        expect(details).toHaveLength(6);
        expect(allText(containerEl)).not.toContain('Deciding what context to use...');
        expect(allText(containerEl)).toContain('Tool step 8');
    });
});
