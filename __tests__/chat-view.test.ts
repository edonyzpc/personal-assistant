import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
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

    removeAttribute(name: string) {
        this.attributes.delete(name);
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

    insertBefore(child: MockElement, referenceChild: MockElement | null) {
        if (referenceChild === null) {
            return this.appendChild(child);
        }
        if (child.parentElement) {
            child.parentElement.removeChild(child);
        }
        const index = this.children.indexOf(referenceChild);
        if (index === -1) {
            throw new Error('Reference child not found');
        }
        child.parentElement = this;
        this.children.splice(index, 0, child);
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

function getLinkByText(root: MockElement, text: string) {
    const link = walk(root, (el) => el.tagName === 'a' && allText(el) === text);
    if (!link) throw new Error(`link not found: ${text}`);
    return link;
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
            for (const linkMatch of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
                const href = linkMatch[1].split('|')[0].trim();
                const link = callout.createEl('a', {
                    text: href,
                    cls: 'internal-link',
                    attr: { href },
                });
                link.setAttribute('data-href', href);
            }
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
            openLinkText: jest.fn(async (_linktext: string, _sourcePath: string, _newLeaf?: boolean | string) => undefined),
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
        call.options.onReasoningChunk?.('late thinking');
        call.onChunk('late chunk');
        call.reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();
        runAnimationFrames(true);

        expect(view.chatHistory).toEqual([]);
        expect(getResponseDiv(view).scrollToCalls).toEqual([]);
        expect(allText(containerEl)).not.toContain('*Generation cancelled*');
        expect(allText(containerEl)).not.toContain('late chunk');
        expect(allText(containerEl)).not.toContain('late thinking');
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

    it('shows a live assistant loader before the first response chunk and reuses the placeholder', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'slow mobile answer';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        const liveUserMessage = getElementByClass(containerEl, 'user');
        const liveAssistantMessages = getElementsByClass(containerEl, 'assistant');
        expect(liveAssistantMessages).toHaveLength(1);
        const liveAssistantMessage = liveAssistantMessages[0];
        expect(allText(liveAssistantMessages[0])).toContain('Assistant');
        const assistantRole = getElementByClass(liveAssistantMessages[0], 'message-role');
        const assistantLoader = getElementByClass(assistantRole, 'pa-chat-role-loader-assistant');
        expect(assistantRole.children[0]).toBe(assistantLoader);
        expect(walk(liveAssistantMessages[0], (el) => el.tagName === 'l-bouncy-arc')).not.toBeNull();
        expect(liveUserMessage.classList.contains('llm-message-enter')).toBe(true);
        expect(liveAssistantMessage.classList.contains('llm-message-enter')).toBe(true);

        streamCalls[0].onChunk('partial answer');
        await flushPromises();
        await flushPromises();

        expect(getElementsByClass(containerEl, 'assistant')).toHaveLength(1);
        expect(allText(containerEl)).toContain('partial answer');

        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'slow mobile answer' },
            { role: 'assistant', content: 'partial answer' },
        ]);
        expect(getElementsByClass(containerEl, 'assistant')).toHaveLength(1);
        expect(getElementByClass(containerEl, 'assistant')).toBe(liveAssistantMessage);
        expect(getElementByClass(containerEl, 'user')).toBe(liveUserMessage);
        expect(getElementsByClass(containerEl, 'pa-chat-role-loader-assistant')).toHaveLength(0);
        expect(liveAssistantMessage.getAttribute('aria-busy')).toBeNull();
        expect(getButtonsByClass(containerEl, 'delete-message-button')).toHaveLength(2);
        expect(getButtonsByClass(containerEl, 'add-to-editor-message-button')).toHaveLength(1);
    });

    it('shows and stops the Thinking loader for terminal turns', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'cancel during thinking';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);

        const thinkingRole = getElementByClass(containerEl, 'thinking-status-role');
        const thinkingLoader = getElementByClass(thinkingRole, 'pa-chat-role-loader-thinking');
        expect(thinkingRole.children[0]).toBe(thinkingLoader);
        expect(walk(containerEl, (el) => el.tagName === 'l-quantum')).not.toBeNull();
        const responseDiv = getResponseDiv(view);
        const thinkingStatus = getElementByClass(responseDiv, 'thinking-status');
        const assistantMessage = getElementByClass(responseDiv, 'assistant');
        expect(responseDiv.children.indexOf(thinkingStatus)).toBeLessThan(responseDiv.children.indexOf(assistantMessage));

        getButtonByClass(containerEl, 'cancel-button').click();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: true,
            allowedMemorySourcePaths: ['memory/cancelled.md'],
            contextUsed: [{
                category: 'memory',
                label: 'Selected Memory',
                detail: 'late cancelled metadata',
                sources: [{ path: 'memory/cancelled.md' }],
                citationEligible: true,
            }],
        });
        streamCalls[0].reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();

        expect(allText(containerEl)).toContain('Generation cancelled');
        expect(allText(containerEl)).not.toContain('late cancelled metadata');
        expect(allText(containerEl)).not.toContain('Selected Memory');
        expect(getElementsByClass(containerEl, 'assistant')).toHaveLength(0);
        expect(getElementsByClass(containerEl, 'pa-chat-role-loader-thinking')).toHaveLength(0);
    });

    it('keeps successful Thinking status as a completed timeline summary', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'status prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);
        streamCalls[0].onChunk('status answer');
        await flushPromises();
        await flushPromises();

        const responseDiv = getResponseDiv(view);
        const userMessage = getElementByClass(responseDiv, 'user');
        const assistantMessage = getElementByClass(responseDiv, 'assistant');
        expect(getElementsByClass(responseDiv, 'thinking-status')).toHaveLength(1);

        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementByClass(responseDiv, 'user')).toBe(userMessage);
        expect(getElementByClass(responseDiv, 'assistant')).toBe(assistantMessage);
        expect(getElementsByClass(responseDiv, 'thinking-status')).toHaveLength(1);
        expect(getElementByClass(responseDiv, 'thinking-status-summary').textContent).toBe('Thinking complete');
        expect(allText(responseDiv)).toContain('Deciding what context to use...');
        expect(getElementsByClass(responseDiv, 'pa-chat-role-loader-thinking')).toHaveLength(0);
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'status prompt' },
            { role: 'assistant', content: 'status answer' },
        ]);
    });

    it('keeps provider reasoning hidden outside the final answer', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'reason about this';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onReasoningChunk?.('first thought. ');
        streamCalls[0].options.onReasoningChunk?.('second thought.');
        streamCalls[0].onChunk('final answer only');
        await flushPromises();
        await flushPromises();

        const responseDiv = getResponseDiv(view);
        expect(getElementsByClass(responseDiv, 'thinking-status')).toHaveLength(1);
        expect(allText(responseDiv)).toContain('Provider thinking');
        expect(allText(responseDiv)).toContain('Provider reasoning was received but is hidden');
        expect(allText(responseDiv)).not.toContain('first thought');
        expect(allText(responseDiv)).not.toContain('second thought');
        expect(allText(responseDiv)).toContain('final answer only');

        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementsByClass(responseDiv, 'thinking-status')).toHaveLength(1);
        expect(getElementByClass(responseDiv, 'thinking-status-summary').textContent).toBe('Thinking complete');
        expect(getElementByClass(responseDiv, 'thinking-status').getAttribute('aria-busy')).toBeNull();
        expect(getElementsByClass(responseDiv, 'pa-chat-role-loader-thinking')).toHaveLength(0);
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'reason about this' },
            { role: 'assistant', content: 'final answer only' },
        ]);
    });

    it('keeps hidden provider reasoning notice when completed turns are redrawn', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'first prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onReasoningChunk?.('persisted reasoning');
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

        const deleteButtons = getButtonsByClass(containerEl, 'delete-message-button');
        expect(deleteButtons).toHaveLength(4);
        deleteButtons[3].click();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'first prompt' },
            { role: 'assistant', content: 'first answer' },
        ]);
        expect(allText(containerEl)).toContain('Provider reasoning was received but is hidden');
        expect(allText(containerEl)).not.toContain('persisted reasoning');
        expect(allText(containerEl)).not.toContain('second answer');
        expect(getElementsByClass(containerEl, 'thinking-status')).toHaveLength(1);
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

    it('records typed partial-output terminal events before the error row', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'partial protocol error';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        streamCalls[0].options.onEvent?.({
            kind: 'partial-output-error',
            turnId: 'turn-test',
            seq: 1,
            timestamp: 0,
            category: 'Error',
        } as never);
        streamCalls[0].reject(new Error('stream interrupted'));
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).toContain('Answer stopped early.');
        expect(allText(containerEl)).toContain('The answer did not finish.');
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

    it('does not apply enter animation when history messages are redrawn', async () => {
        const { view, containerEl } = createView();
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

        expect(getElementsByClass(containerEl, 'llm-message-enter')).toHaveLength(4);
        getButtonsByClass(containerEl, 'delete-message-button')[0].click();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'second prompt' },
            { role: 'assistant', content: 'second answer' },
        ]);
        expect(allText(containerEl)).not.toContain('first prompt');
        expect(allText(containerEl)).toContain('second prompt');
        expect(getElementsByClass(containerEl, 'llm-message-enter')).toHaveLength(0);
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
        expect(retryButton.textContent).not.toContain('Retry');
        expect(retryButton.getAttribute('aria-label')).toBe('Retry message');
        expect(retryButton.getAttribute('title')).toBe('Retry message');
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

    it('waits for the final markdown render before committing a successful live turn', async () => {
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

        getTextArea(containerEl).value = 'async prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('async answer');
        const assistantMessage = getElementByClass(containerEl, 'assistant');
        expect(renderJobs.map((job) => job.markdown)).toEqual(['async prompt', 'async answer']);

        streamCalls[0].resolve();
        await flushPromises();
        expect(renderJobs.map((job) => job.markdown)).toEqual(['async prompt', 'async answer', 'async answer']);
        expect(view.chatHistory).toEqual([]);

        renderJobs[1].resolve();
        await flushPromises();
        expect(allText(containerEl)).not.toContain('async answer');

        renderJobs[2].resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementByClass(containerEl, 'assistant')).toBe(assistantMessage);
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'async prompt' },
            { role: 'assistant', content: 'async answer' },
        ]);
        expect(allText(containerEl)).toContain('async answer');
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

    it('keeps message actions discoverable on touch and narrow panes', () => {
        const css = readFileSync('src/custom.css', 'utf8');

        expect(css).toMatch(/@media\s*\(hover:\s*none\)\s*{[\s\S]*?\.llm-view\s+\.message-actions\s*{[\s\S]*?opacity:\s*1;/);
        expect(css).toMatch(/\.llm-view\.is-narrow\s+\.message-actions\s*{[\s\S]*?opacity:\s*1;/);
    });

    it('pins message action buttons to icon size in mobile button styles', () => {
        const css = readFileSync('src/custom.css', 'utf8');

        expect(css).toMatch(/\.llm-view\s+\.message-action-button\s*{[\s\S]*?appearance:\s*none;[\s\S]*?flex:\s*0 0 24px;[\s\S]*?min-width:\s*24px;[\s\S]*?min-height:\s*24px;[\s\S]*?max-width:\s*24px;[\s\S]*?max-height:\s*24px;[\s\S]*?box-shadow:\s*none;/);
        expect(css).toMatch(/\.llm-view\s+\.message-action-button\s+svg\s*{[\s\S]*?display:\s*block;[\s\S]*?flex:\s*0 0 auto;/);
    });

    it('keeps ldrs chat loaders visible when reduced motion is enabled', () => {
        const css = readFileSync('src/custom.css', 'utf8');
        const reducedMotionStart = css.indexOf('@media (prefers-reduced-motion: reduce)');
        const reducedMotionEnd = css.indexOf('.llm-view.is-narrow', reducedMotionStart);
        const reducedMotionBlock = css.slice(reducedMotionStart, reducedMotionEnd);

        expect(reducedMotionStart).toBeGreaterThanOrEqual(0);
        expect(reducedMotionEnd).toBeGreaterThan(reducedMotionStart);
        expect(reducedMotionBlock).not.toContain('.pa-chat-role-loader-element');
        expect(reducedMotionBlock).not.toMatch(/\.pa-chat-role-loader-fallback\s*{[\s\S]*?display:\s*inline-flex;/);
    });

    it('uses a bright vivid color cycle for ldrs chat loaders', () => {
        const css = readFileSync('src/custom.css', 'utf8');
        const colorCycleStart = css.indexOf('@keyframes pa-chat-loader-color-cycle');
        const colorCycleEnd = css.indexOf('.llm-view .thinking-status-header', colorCycleStart);
        const colorCycleBlock = css.slice(colorCycleStart, colorCycleEnd);

        expect(colorCycleStart).toBeGreaterThanOrEqual(0);
        expect(colorCycleEnd).toBeGreaterThan(colorCycleStart);
        expect(css).toContain('--pa-chat-loader-color-rose: #ff2d55;');
        expect(css).toContain('--pa-chat-loader-color-orange: #ff9500;');
        expect(css).toContain('--pa-chat-loader-color-lime: #32d74b;');
        expect(css).toContain('--pa-chat-loader-color-cyan: #00c7ff;');
        expect(css).toContain('--pa-chat-loader-color-violet: #bf5af2;');
        expect(colorCycleBlock).not.toContain('--interactive-accent');
        expect(colorCycleBlock).not.toContain('--color-cyan');
        expect(colorCycleBlock).not.toContain('--color-green');
        expect(colorCycleBlock).not.toContain('--color-yellow');
    });

    it('keeps the chat composer in the visible flex area when mobile keyboards shrink the visual viewport', () => {
        const css = readFileSync('src/custom.css', 'utf8');

        expect(css).toMatch(/\.llm-view\s*{[\s\S]*?--pa-chat-keyboard-clearance:\s*0px;[\s\S]*?--pa-chat-composer-height:\s*0px;[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?padding:\s*0 0 var\(--pa-chat-keyboard-clearance,\s*0px\);[\s\S]*?position:\s*relative;/);
        expect(css).not.toMatch(/\.llm-view\.is-keyboard-open\s*{[\s\S]*?padding-bottom:\s*0;/);
        expect(css).toMatch(/\.llm-chat-container\s*{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;/);
        expect(css).toMatch(/\.llm-view\.is-keyboard-open\s+\.llm-chat-container\s*{[\s\S]*?padding-bottom:\s*calc\(14px \+ var\(--pa-chat-composer-height,\s*0px\)\);/);
        expect(css).toMatch(/\.pa-chat-empty-state\s*{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-height:\s*100%;/);
        expect(css).toMatch(/\.llm-input\s*{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?z-index:\s*3;/);
        expect(css).toMatch(/\.llm-view\.is-keyboard-open\s+\.llm-input\s*{[\s\S]*?position:\s*absolute;[\s\S]*?bottom:\s*var\(--pa-chat-keyboard-clearance,\s*0px\);[\s\S]*?z-index:\s*30;/);
    });

    it('keeps message bubble enter animation opt-in', () => {
        const css = readFileSync('src/custom.css', 'utf8');
        const messageBaseRule = css.match(/\.llm-message\s*{([\s\S]*?)\n}/);

        expect(messageBaseRule?.[1]).not.toMatch(/\banimation\s*:/);
        expect(css).toMatch(/\.llm-message\.llm-message-enter\s*{[\s\S]*?animation:\s*message-fade-in 160ms ease-out;/);
        expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*?\.llm-message\.llm-message-enter\s*{[\s\S]*?animation:\s*none;/);
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

    it('reserves keyboard clearance from the mobile visual viewport and disconnects listeners', async () => {
        const { view, containerEl } = createView({ panelWidth: 430 });
        containerEl.boundingRect = { left: 0, top: 0, right: 430, bottom: 900, width: 430, height: 900 };
        const viewportState = { offsetTop: 0, height: 540 };
        const viewportListeners = new Map<string, Array<() => void>>();
        const visualViewport = {
            get offsetTop() {
                return viewportState.offsetTop;
            },
            get height() {
                return viewportState.height;
            },
            addEventListener: jest.fn((type: string, listener: () => void) => {
                const listeners = viewportListeners.get(type) ?? [];
                listeners.push(listener);
                viewportListeners.set(type, listeners);
            }),
            removeEventListener: jest.fn(),
        } as unknown as VisualViewport;
        Object.defineProperty(globalThis.window, 'visualViewport', {
            configurable: true,
            value: visualViewport,
        });

        await view.onOpen();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('360px');
        expect(visualViewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(visualViewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));

        viewportState.height = 900;
        viewportListeners.get('resize')?.forEach((listener) => listener());
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('0px');

        await view.onClose();

        expect(visualViewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(visualViewport.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    });

    it('uses native mobile keyboard events when the visual viewport does not report keyboard overlap', async () => {
        const { view, containerEl } = createView({ panelWidth: 430 });
        containerEl.boundingRect = { left: 0, top: 0, right: 430, bottom: 900, width: 430, height: 900 };
        const windowListeners = new Map<string, Array<EventListener>>();
        const windowWithKeyboardEvents = globalThis.window as typeof globalThis.window & {
            innerHeight: number;
            innerWidth: number;
            addEventListener: jest.Mock;
            removeEventListener: jest.Mock;
        };
        windowWithKeyboardEvents.innerHeight = 900;
        windowWithKeyboardEvents.innerWidth = 430;
        windowWithKeyboardEvents.addEventListener = jest.fn((type: string, listener: EventListener) => {
            const listeners = windowListeners.get(type) ?? [];
            listeners.push(listener);
            windowListeners.set(type, listeners);
        });
        windowWithKeyboardEvents.removeEventListener = jest.fn();

        await view.onOpen();

        expect(windowWithKeyboardEvents.addEventListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));

        windowListeners.get('keyboardWillShow')?.forEach((listener) => {
            listener({ keyboardHeight: 336 } as Event & { keyboardHeight: number });
        });
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('336px');

        windowListeners.get('keyboardWillHide')?.forEach((listener) => {
            listener({} as Event);
        });
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('0px');

        await view.onClose();

        expect(windowWithKeyboardEvents.removeEventListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));
        expect(windowWithKeyboardEvents.removeEventListener).toHaveBeenCalledWith('keyboardWillHide', expect.any(Function));
    });

    it('pre-reserves keyboard clearance on mobile focus before keyboard height events arrive', async () => {
        const { view, containerEl } = createView({ panelWidth: 430 });
        containerEl.boundingRect = { left: 0, top: 0, right: 430, bottom: 900, width: 430, height: 900 };
        const documentListeners = new Map<string, Array<EventListener>>();
        const documentWithFocus = {
            activeElement: null as MockElement | null,
            querySelector: jest.fn(() => null),
            addEventListener: jest.fn((type: string, listener: EventListener) => {
                const listeners = documentListeners.get(type) ?? [];
                listeners.push(listener);
                documentListeners.set(type, listeners);
            }),
            removeEventListener: jest.fn(),
        };
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: documentWithFocus,
        });
        const mobileWindow = globalThis.window as typeof globalThis.window & {
            innerHeight: number;
            innerWidth: number;
        };
        mobileWindow.innerHeight = 900;
        mobileWindow.innerWidth = 430;
        Object.defineProperty(globalThis.window, 'matchMedia', {
            configurable: true,
            value: jest.fn(() => ({ matches: true } as MediaQueryList)),
        });
        Object.defineProperty(globalThis.navigator, 'maxTouchPoints', {
            configurable: true,
            value: 5,
        });

        await view.onOpen();

        documentWithFocus.activeElement = getTextArea(containerEl);
        documentListeners.get('focusin')?.forEach((listener) => {
            listener({} as Event);
        });

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('405px');
        expect(containerEl.style.getPropertyValue('--pa-chat-composer-height')).toBe('80px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(true);

        await view.onClose();

        expect(documentWithFocus.removeEventListener).toHaveBeenCalledWith('focusin', expect.any(Function));
        expect(documentWithFocus.removeEventListener).toHaveBeenCalledWith('focusout', expect.any(Function));
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

    it('keeps verified Memory references as a rendered callout', async () => {
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

        expect(getElementsByClass(containerEl, 'pa-chat-source-bar')).toHaveLength(0);
        expect(allText(containerEl)).not.toContain('Memory used');
        expect(allText(containerEl)).toContain('Memory references');
        expect(getElementsByClass(containerEl, 'callout')).toHaveLength(1);
        expect(getLinkByText(containerEl, 'memory/trusted.md').getAttribute('data-href')).toBe('memory/trusted.md');
    });

    it('renders Context Used separately from strict Memory references', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'context prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: true,
            allowedMemorySourcePaths: ['0.unsorted/Dog.md'],
            contextUsed: [
                {
                    category: 'memory',
                    label: 'Selected Memory',
                    detail: '1 selected note',
                    sources: [{ path: '0.unsorted/Dog.md' }],
                    citationEligible: true,
                },
                {
                    category: 'current-note',
                    label: 'Current note',
                    detail: 'Read-only current note context',
                    sources: [{ path: 'notes/current.md' }],
                    citationEligible: false,
                },
            ],
        });
        streamCalls[0].options.onStatus?.({ type: 'web-search-enabled' });
        streamCalls[0].onChunk('answer without citation block');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const text = allText(containerEl);
        expect(text).toContain('Context Used');
        expect(text).toContain('Selected Memory');
        expect(text).toContain('Current note');
        expect(text).toContain('Provider web search');
        expect(text).toContain('Dog');
        expect(text).toContain('current');
        expect(text).toContain('Eligible for Memory references');
        expect(text).toContain('Not a Memory reference');
        expect(text).toContain('Status only');
        expect(text).not.toContain('0.unsorted/Dog.md');
        expect(text).not.toContain('notes/current.md');
        expect(getElementsByClass(containerEl, 'pa-chat-source-bar')).toHaveLength(0);
    });

    it('keeps the rendered Memory references callout when metadata arrives after the final chunk', async () => {
        mockRenderedMemoryCallout();
        const { view, containerEl } = createView();
        await view.onOpen();

        const answer = [
            'answer from late memory metadata',
            '',
            '---',
            '> [!personal-assistant-ai]- Memory references',
            '>',
            '> 1. [[memory/late.md]]',
        ].join('\n');
        getTextArea(containerEl).value = 'late memory prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk(answer);
        await flushPromises();
        await flushPromises();

        expect(getElementsByClass(containerEl, 'pa-chat-source-bar')).toHaveLength(0);
        expect(allText(containerEl)).toContain('Memory references');

        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: true,
            allowedMemorySourcePaths: ['memory/late.md'],
        });
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'late memory prompt' },
            { role: 'assistant', content: answer },
        ]);
        expect(getElementsByClass(containerEl, 'pa-chat-source-bar')).toHaveLength(0);
        expect(allText(containerEl)).not.toContain('Memory used');
        expect(allText(containerEl)).toContain('Memory references');
    });

    it('opens Memory reference note links in a new tab even when a Markdown leaf is available', async () => {
        mockRenderedMemoryCallout();
        const { view, containerEl, app } = createView({ withMarkdownLeaf: true });
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

        const event = {
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
            metaKey: false,
            ctrlKey: false,
        };
        getLinkByText(containerEl, 'memory/trusted.md').dispatchEvent('click', event);
        await flushPromises();

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();
        expect(app.workspace.openLinkText).toHaveBeenCalledWith('memory/trusted.md', '0.unsorted/Dog.md', 'tab');
    });

    it('opens Memory reference note links in a new tab when no Markdown leaf is available', async () => {
        mockRenderedMemoryCallout();
        const { view, containerEl, app } = createView();
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
        streamCalls[0].onChunk(answer);
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        getLinkByText(containerEl, 'memory/trusted.md').dispatchEvent('click', {
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
            metaKey: false,
            ctrlKey: false,
        });
        await flushPromises();

        expect(app.workspace.setActiveLeaf).not.toHaveBeenCalled();
        expect(app.workspace.openLinkText).toHaveBeenCalledWith('memory/trusted.md', '', 'tab');
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

    it('keeps the rendered references content without source-bar transformation', async () => {
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
                type: 'memory-prefetching',
                query: `step ${index}`,
            } as ChatAgentStatus);
        }

        const details = getElementsByClass(containerEl, 'thinking-status-detail-item');
        expect(details).toHaveLength(6);
        expect(allText(containerEl)).not.toContain('Deciding what context to use...');
        expect(allText(containerEl)).toContain('Searching notes: step 8');
    });

    it('uses product language for Memory activity statuses', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'memory status prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({ type: 'memory-reranking', candidateCount: 2 });
        streamCalls[0].options.onStatus?.({
            type: 'memory-expanded',
            sources: [{ path: 'folder/project.md' }],
            anchoredCount: 1,
            indexedFallbackCount: 1,
        });
        streamCalls[0].options.onStatus?.({ type: 'memory-skipped', reason: 'Memory search returned 0 source(s).' });
        streamCalls[0].options.onStatus?.({
            type: 'tool-running',
            tool: 'read_note_outline',
            message: 'Reading outline for 0.unsorted/Dog.md',
        });
        streamCalls[0].options.onStatus?.({ type: 'tool-skipped', tool: 'read_note_outline', reason: 'technical tool failure' });
        streamCalls[0].options.onStatus?.({ type: 'web-search-enabled' });

        expect(allText(containerEl)).toContain('No related memory');
        expect(allText(containerEl)).toContain('Checking 2 related notes...');
        expect(allText(containerEl)).toContain('Reading selected Memory...');
        expect(allText(containerEl)).toContain('Vault context unavailable');
        expect(allText(containerEl)).toContain('Reading note outline...');
        expect(allText(containerEl)).toContain('Qwen may search the web');
        expect(allText(containerEl)).toContain('Context Used');
        expect(allText(containerEl)).toContain('Provider web search');
        expect(allText(containerEl)).not.toContain('fallback path');
        expect(allText(containerEl)).not.toContain('memory references');
        expect(allText(containerEl)).not.toContain('candidate');
        expect(allText(containerEl)).not.toContain('indexed fallback');
        expect(allText(containerEl)).not.toContain('Fallback');
        expect(allText(containerEl)).not.toContain('Read-only tool');
        expect(allText(containerEl)).not.toContain('0.unsorted/Dog.md');
    });

    it('shows gathered-context wording when the planning limit is reached', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'loop cap prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({
            type: 'fallback',
            reason: 'Model turn cap reached; answering from gathered context.',
        });

        expect(allText(containerEl)).toContain('Using gathered context after reaching the planning limit.');
        expect(allText(containerEl)).toContain('Context Used');
        expect(allText(containerEl)).toContain('Using gathered context');
        expect(allText(containerEl)).toContain('planning limit');
    });
});
