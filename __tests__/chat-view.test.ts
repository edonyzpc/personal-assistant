import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MarkdownRenderer, MarkdownView } from 'obsidian';
import type { ChatAgentStatus, StreamLLMOptions } from '../src/ai-services/chat-service';
import { CHAT_MENU_IDLE_CLOSE_MS, LLMView } from '../src/chat-view';
import type { MemoryMaintenancePlan } from '../src/memory-manager';

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

type MockRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
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
    readonly style = {
        values: new Map<string, string>(),
        setProperty: (name: string, value: string) => {
            this.style.values.set(name, value);
        },
        getPropertyValue: (name: string) => this.style.values.get(name) ?? '',
    };
    parentElement: MockElement | null = null;
    textContent = '';
    private _value = '';
    disabled = false;
    hidden = false;
    scrollHeight = 120;
    scrollTop = 0;
    clientWidth = 600;
    clientHeight = 80;
    boundingRect: MockRect | null = null;
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

    querySelectorAll(selector: string) {
        if (selector === '.callout[data-callout="personal-assistant-ai"]') {
            return walkAll(this, (el) =>
                el.classList.contains('callout') && el.getAttribute('data-callout') === 'personal-assistant-ai'
            );
        }
        if (selector === 'a.internal-link') {
            return walkAll(this, (el) => el.tagName === 'a' && el.classList.contains('internal-link'));
        }
        return [] as MockElement[];
    }

    scrollTo(options: { top?: number; behavior?: ScrollBehavior }) {
        this.scrollToCalls.push(options);
        this.scrollTop = options.top ?? this.scrollTop;
    }

    getBoundingClientRect() {
        return this.boundingRect ?? {
            left: 0,
            top: 0,
            right: this.clientWidth,
            bottom: this.clientHeight,
            width: this.clientWidth,
            height: this.clientHeight,
        };
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
    const button = walk(root, (el) => el.tagName === 'button' && (el.textContent === text || allText(el) === text));
    if (!button) throw new Error(`button not found: ${text}`);
    return button;
}

function getButtonsByText(root: MockElement, text: string) {
    return walkAll(root, (el) => el.tagName === 'button' && (el.textContent === text || allText(el) === text));
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

function mockRenderedMemoryCallout() {
    (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
        el.setText(markdown.replace(/\n+---\s*\n>\s*\[!personal-assistant-ai\]-\s*Memory references\b[\s\S]*$/i, ''));
        if (/>\s*\[!personal-assistant-ai\]-\s*Memory references\b/i.test(markdown)) {
            const callout = el.createDiv({
                cls: 'callout',
                attr: { 'data-callout': 'personal-assistant-ai' },
            });
            callout.setText('Memory references');
        }
    });
}

function createView(options: { withMarkdownLeaf?: boolean; panelWidth?: number } = {}) {
    const containerEl = new MockElement('div');
    containerEl.clientWidth = options.panelWidth ?? 600;
    const workspaceHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
    const memoryStatusListeners = new Set<() => void | Promise<void>>();
    const editor = {
        getCursor: jest.fn(() => ({ line: 0, ch: 0 })),
        replaceRange: jest.fn(),
    };
    const markdownLeaf = {
        view: new MarkdownView(editor as unknown as ConstructorParameters<typeof MarkdownView>[0]),
    };
    const markdownFile = { path: '0.unsorted/Dog.md', extension: 'md' };
    const app = {
        workspace: {
            getActiveFile: jest.fn(() => options.withMarkdownLeaf ? markdownFile : null),
            getActiveViewOfType: jest.fn(() => options.withMarkdownLeaf ? markdownLeaf.view : null),
            getMostRecentLeaf: jest.fn(() => options.withMarkdownLeaf ? markdownLeaf : null),
            getLeavesOfType: jest.fn(() => options.withMarkdownLeaf ? [markdownLeaf] : []),
            setActiveLeaf: jest.fn(),
            on: jest.fn((eventName: string, callback: (...args: unknown[]) => void) => {
                const handlers = workspaceHandlers.get(eventName) ?? [];
                handlers.push(callback);
                workspaceHandlers.set(eventName, handlers);
                return { eventName, callback };
            }),
        },
        vault: {
            getName: jest.fn(() => 'test'),
        },
        setting: {
            open: jest.fn(),
            openTabById: jest.fn(),
        },
    };
    const plugin = {
        app,
        settings: {
            memoryEnabled: true,
            memoryApprovalPolicy: 'always',
        },
        memoryManager: {
            getMaintenancePlan: jest.fn(async (): Promise<MemoryMaintenancePlan> => ({
                reason: 'ready',
                action: 'none',
                notesToCheck: 0,
                requiresApproval: false,
                canAnswerNow: true,
            })),
            prepareFromCommand: jest.fn(async () => undefined),
            updateFromCommand: jest.fn(async () => undefined),
        },
        showTechnicalMemoryStatus: jest.fn(async () => undefined),
        onMemoryStatusChanged: jest.fn((listener: () => void | Promise<void>) => {
            memoryStatusListeners.add(listener);
            return () => {
                memoryStatusListeners.delete(listener);
            };
        }),
        log: jest.fn(),
    };
    const leaf = { app, containerEl };
    const view = new LLMView(
        leaf as unknown as ConstructorParameters<typeof LLMView>[0],
        plugin as unknown as ConstructorParameters<typeof LLMView>[1],
        {} as unknown as ConstructorParameters<typeof LLMView>[2],
    );
    const emitWorkspaceEvent = (eventName: string, ...args: unknown[]) => {
        for (const handler of workspaceHandlers.get(eventName) ?? []) {
            handler(...args);
        }
    };
    const emitMemoryStatusChanged = async () => {
        await Promise.all(Array.from(memoryStatusListeners, (listener) => listener()));
    };
    const getMemoryStatusListenerCount = () => memoryStatusListeners.size;
    return {
        view,
        containerEl,
        app,
        plugin,
        editor,
        markdownLeaf,
        markdownFile,
        emitWorkspaceEvent,
        emitMemoryStatusChanged,
        getMemoryStatusListenerCount,
    };
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

    afterEach(() => {
        jest.useRealTimers();
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

    it('keeps partial streamed content out of reusable editor actions after cancellation', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'partial prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        const call = streamCalls[0];
        call.onChunk('partial answer');
        expect(view.result).toBe('');
        expect(getButtonsByText(containerEl, 'Add to Editor')).toHaveLength(0);
        getButtonByClass(containerEl, 'cancel-button').click();
        call.reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();

        expect(view.result).toBe('');
        expect(getButtonsByText(containerEl, 'Add to Editor')).toHaveLength(0);
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

    it('refreshes empty state chips when a markdown note becomes active', async () => {
        const { view, containerEl, app, markdownLeaf, markdownFile, emitWorkspaceEvent } = createView();
        await view.onOpen();

        expect(getButtonByText(containerEl, 'Summarize current note').disabled).toBe(true);
        app.workspace.getActiveFile.mockReturnValue(markdownFile);
        app.workspace.getActiveViewOfType.mockReturnValue(markdownLeaf.view);
        app.workspace.getMostRecentLeaf.mockReturnValue(markdownLeaf);
        app.workspace.getLeavesOfType.mockReturnValue([markdownLeaf]);

        emitWorkspaceEvent('active-leaf-change', markdownLeaf);

        expect(getButtonByText(containerEl, 'Summarize current note').disabled).toBe(false);
        expect(getButtonByText(containerEl, 'Find related notes').disabled).toBe(false);
        expect(getButtonByText(containerEl, 'Draft from current note').disabled).toBe(false);
        expect(allText(containerEl)).not.toContain('Open a note to use this.');

        getButtonByText(containerEl, 'Summarize current note').click();

        expect(getTextArea(containerEl).value).toBe('Summarize the current note.');
        expect(getButtonByText(containerEl, 'Ask').disabled).toBe(false);
    });

    it('uses panel-width density classes instead of viewport media queries', async () => {
        const { view, containerEl } = createView({ panelWidth: 340 });
        await view.onOpen();

        expect(containerEl.classList.contains('is-narrow')).toBe(true);
        expect(containerEl.classList.contains('is-compact')).toBe(true);
    });

    it('anchors Memory and More menus inside their composer action controls', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();
        await flushPromises();

        const actions = getElementByClass(containerEl, 'pa-chat-composer-actions');
        const composerRow = getElementByClass(containerEl, 'pa-chat-composer-row');
        const askButton = getButtonByText(containerEl, 'Ask');
        const memoryControl = getElementByClass(containerEl, 'pa-chat-memory-control');
        const memoryChip = getButtonByClass(containerEl, 'pa-chat-memory-chip');
        const memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');
        const cancelButton = getButtonByClass(containerEl, 'cancel-button');
        const moreControl = getElementByClass(containerEl, 'pa-chat-more-control');
        const moreButton = getButtonByClass(containerEl, 'pa-chat-more-button');
        const composerMenu = getElementByClass(containerEl, 'pa-chat-composer-menu');

        expect(composerRow.children).toEqual([getTextArea(containerEl), actions]);
        expect(actions.parentElement).toBe(composerRow);
        expect(actions.children).toEqual([askButton, memoryControl, cancelButton, moreControl]);
        expect(actions.children.indexOf(memoryControl)).toBe(actions.children.indexOf(askButton) + 1);
        expect(actions.children.indexOf(moreControl)).toBe(actions.children.length - 1);
        expect(getButtonsByText(actions, 'Add to Editor')).toHaveLength(0);
        expect(memoryControl.children).toContain(memoryChip);
        expect(memoryControl.children).toContain(memoryMenu);
        expect(moreControl.children).toContain(moreButton);
        expect(moreControl.children).toContain(composerMenu);
        expect(memoryChip.classList.contains('pa-chat-icon-button')).toBe(true);
        expect(memoryChip.classList.contains('personal-assistant-ai-statusbar')).toBe(true);
        expect(memoryChip.classList.contains('personal-assistant-ai-statusbar-ready')).toBe(true);
        expect(memoryChip.getAttribute('aria-label')).toBe('Memory ready');
    });

    it('reserves bottom clearance when the Obsidian status bar overlaps the chat view', async () => {
        const { view, containerEl } = createView({ panelWidth: 900 });
        const statusBar = new MockElement('div');
        containerEl.boundingRect = { left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 };
        statusBar.boundingRect = { left: 600, top: 672, right: 900, bottom: 700, width: 300, height: 28 };
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                querySelector: jest.fn((selector: string) => selector === '.status-bar' ? statusBar : null),
            },
        });

        await view.onOpen();

        expect(containerEl.style.getPropertyValue('--pa-chat-status-bar-clearance')).toBe('28px');
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
        const composerActions = getElementByClass(containerEl, 'pa-chat-composer-actions');
        expect(addButtons).toHaveLength(2);
        expect(getButtonsByText(composerActions, 'Add to Editor')).toHaveLength(0);
        addButtons[0].click();
        await flushPromises();

        expect(editor.replaceRange).toHaveBeenCalledWith('first answer', { line: 0, ch: 0 });
    });

    it('turns verified Memory references into a collapsed source bar', async () => {
        mockRenderedMemoryCallout();
        const { view, containerEl } = createView();
        await view.onOpen();

        const answer = [
            'answer from memory',
            '',
            '---',
            '> [!personal-assistant-ai]- Memory references',
            '>',
            '> 1. [[memory/trusted.md]]',
        ].join('\n');
        getTextArea(containerEl).value = 'memory prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: true,
            allowedMemorySourcePaths: ['memory/trusted.md'],
        });
        streamCalls[0].onChunk(answer);
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementsByClass(containerEl, 'pa-chat-source-bar')).toHaveLength(1);
        expect(allText(containerEl)).toContain('Memory used (1)');
        expect(allText(containerEl)).not.toContain('Memory references');
        const toggle = getButtonByClass(containerEl, 'pa-chat-source-toggle');
        const sourceList = getElementByClass(containerEl, 'pa-chat-source-list');
        expect(toggle.getAttribute('aria-controls')).toBe(sourceList.id);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(sourceList.hidden).toBe(true);

        toggle.click();

        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(sourceList.hidden).toBe(false);
    });

    it('keeps the rendered callout when Memory references are not from allowed sources', async () => {
        mockRenderedMemoryCallout();
        const { view, containerEl } = createView();
        await view.onOpen();

        const answer = [
            'answer with unsafe source',
            '',
            '---',
            '> [!personal-assistant-ai]- Memory references',
            '>',
            '> 1. [[notes/current.md]]',
        ].join('\n');
        getTextArea(containerEl).value = 'memory prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: true,
            allowedMemorySourcePaths: ['memory/trusted.md'],
        });
        streamCalls[0].onChunk(answer);
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementsByClass(containerEl, 'pa-chat-source-bar')).toHaveLength(0);
        expect(allText(containerEl)).toContain('Memory references');
    });

    it('keeps the rendered callout when Memory metadata is absent or transform cannot remove it', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        const answer = [
            'answer with normal fallback',
            '',
            '---',
            '> [!personal-assistant-ai]- Memory references',
            '>',
            '> 1. [[memory/trusted.md]]',
        ].join('\n');
        getTextArea(containerEl).value = 'memory prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: true,
            allowedMemorySourcePaths: ['memory/trusted.md'],
        });
        streamCalls[0].onChunk(answer);
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementsByClass(containerEl, 'pa-chat-source-bar')).toHaveLength(0);
        expect(allText(containerEl)).toContain('Memory references');
    });

    it('keeps Add to Editor content as the original Markdown with Memory references', async () => {
        mockRenderedMemoryCallout();
        const { view, containerEl, editor } = createView({ withMarkdownLeaf: true });
        await view.onOpen();

        const answer = [
            'answer from memory',
            '',
            '---',
            '> [!personal-assistant-ai]- Memory references',
            '>',
            '> 1. [[memory/trusted.md]]',
        ].join('\n');
        getTextArea(containerEl).value = 'memory prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: true,
            allowedMemorySourcePaths: ['memory/trusted.md'],
        });
        streamCalls[0].onChunk(answer);
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        getButtonByClass(containerEl, 'add-to-editor-message-button').click();
        await flushPromises();

        expect(editor.replaceRange).toHaveBeenCalledWith(answer, { line: 0, ch: 0 });
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

        const memoryStatusButton = getButtonByText(containerEl, 'Show Memory Status');
        const memoryStatusIcon = getElementByClass(memoryStatusButton, 'pa-chat-menu-item-icon');
        const memoryStatusText = getElementByClass(memoryStatusButton, 'pa-chat-menu-item-text');
        expect(memoryStatusText.textContent).toBe('Show Memory Status');
        expect(memoryStatusButton.children).toEqual([memoryStatusIcon, memoryStatusText]);
        memoryStatusButton.click();
        expect(plugin.showTechnicalMemoryStatus).toHaveBeenCalledTimes(1);
    });

    it('auto-closes the composer More menu after idle time and resets on activity', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        jest.useFakeTimers();
        const moreButton = getButtonByClass(containerEl, 'pa-chat-more-button');
        const composerMenu = getElementByClass(containerEl, 'pa-chat-composer-menu');

        moreButton.click();
        expect(composerMenu.hidden).toBe(false);

        jest.advanceTimersByTime(CHAT_MENU_IDLE_CLOSE_MS - 1);
        composerMenu.dispatchEvent('mousemove');
        jest.advanceTimersByTime(CHAT_MENU_IDLE_CLOSE_MS - 1);
        expect(composerMenu.hidden).toBe(false);

        jest.advanceTimersByTime(1);
        expect(composerMenu.hidden).toBe(true);
        expect(moreButton.getAttribute('aria-expanded')).toBe('false');
    });

    it('auto-closes the Memory chip menu after idle time and resets on activity', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        jest.useFakeTimers();
        const memoryChip = getButtonByClass(containerEl, 'pa-chat-memory-chip');
        const memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');

        memoryChip.click();
        for (let i = 0; i < 5; i += 1) {
            await Promise.resolve();
        }
        expect(memoryMenu.hidden).toBe(false);

        jest.advanceTimersByTime(CHAT_MENU_IDLE_CLOSE_MS - 1);
        memoryMenu.dispatchEvent('mousemove');
        jest.advanceTimersByTime(CHAT_MENU_IDLE_CLOSE_MS - 1);
        expect(memoryMenu.hidden).toBe(false);

        jest.advanceTimersByTime(1);
        expect(memoryMenu.hidden).toBe(true);
        expect(memoryChip.getAttribute('aria-expanded')).toBe('false');
    });

    it('auto-closes a message action menu after idle time', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'hello';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        jest.useFakeTimers();
        const messageMenuButton = getButtonByClass(containerEl, 'message-more-button');
        const messageMenu = getElementByClass(containerEl, 'pa-chat-message-menu');

        messageMenuButton.click();
        expect(messageMenu.hidden).toBe(false);
        expect(messageMenuButton.getAttribute('aria-expanded')).toBe('true');

        jest.advanceTimersByTime(CHAT_MENU_IDLE_CLOSE_MS);
        expect(messageMenu.hidden).toBe(true);
        expect(messageMenuButton.getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps the Memory chip menu and More menu mutually exclusive', async () => {
        let resolvePlan: (plan: MemoryMaintenancePlan) => void = () => {};
        const pendingPlan = new Promise<MemoryMaintenancePlan>((resolve) => {
            resolvePlan = resolve;
        });
        const { view, containerEl, plugin } = createView();
        plugin.memoryManager.getMaintenancePlan.mockReturnValue(pendingPlan);
        await view.onOpen();

        const memoryChip = getButtonByClass(containerEl, 'pa-chat-memory-chip');
        const memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');
        const moreButton = getButtonByClass(containerEl, 'pa-chat-more-button');
        const composerMenu = getElementByClass(containerEl, 'pa-chat-composer-menu');

        memoryChip.click();
        moreButton.click();
        expect(composerMenu.hidden).toBe(false);
        expect(moreButton.getAttribute('aria-expanded')).toBe('true');
        expect(memoryMenu.hidden).toBe(true);
        expect(memoryChip.getAttribute('aria-expanded')).toBe('false');

        resolvePlan({
            reason: 'ready',
            action: 'none',
            notesToCheck: 0,
            requiresApproval: false,
            canAnswerNow: true,
        });
        await flushPromises();

        expect(memoryMenu.hidden).toBe(true);
        expect(memoryChip.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens the Memory chip menu with product state and update action', async () => {
        const { view, containerEl, plugin } = createView();
        plugin.memoryManager.getMaintenancePlan.mockResolvedValue({
            reason: 'changed-notes',
            action: 'refresh',
            notesToCheck: 4,
            notesLikelyToUpdate: 2,
            requiresApproval: true,
            canAnswerNow: true,
        });
        await view.onOpen();
        await flushPromises();

        const memoryChip = getButtonByClass(containerEl, 'pa-chat-memory-chip');
        memoryChip.click();
        await flushPromises();

        const memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');
        expect(memoryMenu.hidden).toBe(false);
        expect(memoryChip.getAttribute('aria-expanded')).toBe('true');
        expect(allText(memoryMenu)).toContain('Memory needs update');
        getButtonByText(memoryMenu, 'Update memory').click();
        await flushPromises();

        expect(plugin.memoryManager.updateFromCommand).toHaveBeenCalledTimes(1);
    });

    it('refreshes the Memory chip when background memory status changes', async () => {
        const { view, containerEl, plugin, emitMemoryStatusChanged } = createView();
        plugin.memoryManager.getMaintenancePlan
            .mockResolvedValueOnce({
                reason: 'changed-notes',
                action: 'refresh',
                notesToCheck: 4,
                notesLikelyToUpdate: 2,
                requiresApproval: true,
                canAnswerNow: true,
            })
            .mockResolvedValue({
                reason: 'ready',
                action: 'none',
                notesToCheck: 4,
                requiresApproval: false,
                canAnswerNow: true,
            });

        await view.onOpen();
        await flushPromises();

        const memoryChip = getButtonByClass(containerEl, 'pa-chat-memory-chip');
        expect(memoryChip.classList.contains('personal-assistant-ai-statusbar-needs-update')).toBe(true);
        expect(memoryChip.getAttribute('aria-label')).toBe('Memory needs update');

        await emitMemoryStatusChanged();
        await flushPromises();

        expect(memoryChip.classList.contains('personal-assistant-ai-statusbar-needs-update')).toBe(false);
        expect(memoryChip.classList.contains('personal-assistant-ai-statusbar-ready')).toBe(true);
        expect(memoryChip.getAttribute('aria-label')).toBe('Memory ready');
    });

    it('unsubscribes Memory chip status refresh on close', async () => {
        const { view, getMemoryStatusListenerCount } = createView();

        await view.onOpen();
        expect(getMemoryStatusListenerCount()).toBe(1);

        await view.onClose();
        expect(getMemoryStatusListenerCount()).toBe(0);
    });

    it('keeps Memory diagnostics and settings behind menu entries', async () => {
        const { view, containerEl, plugin, app } = createView();
        await view.onOpen();
        await flushPromises();

        getButtonByClass(containerEl, 'pa-chat-memory-chip').click();
        await flushPromises();
        let memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');
        getButtonByText(memoryMenu, 'Open settings').click();
        expect(app.setting.open).toHaveBeenCalledTimes(1);
        expect(app.setting.openTabById).toHaveBeenCalledWith('personal-assistant');

        getButtonByClass(containerEl, 'pa-chat-memory-chip').click();
        await flushPromises();
        memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');
        getButtonByText(memoryMenu, 'Show Memory Status').click();
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

    it('uses product language for Memory activity statuses', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'memory status prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({ type: 'memory-prefetching', query: 'project' });
        streamCalls[0].options.onStatus?.({ type: 'memory-prefetched', query: 'project', sources: [] });
        streamCalls[0].options.onStatus?.({ type: 'memory-skipped', reason: 'Memory search returned 0 source(s).' });
        streamCalls[0].options.onStatus?.({ type: 'fallback', reason: 'planner failed' });

        expect(allText(containerEl)).toContain('Searching notes: project');
        expect(allText(containerEl)).toContain('No related memory');
        expect(allText(containerEl)).toContain('I will answer normally this time.');
        expect(allText(containerEl)).not.toContain('fallback path');
        expect(allText(containerEl)).not.toContain('memory references');
    });
});
