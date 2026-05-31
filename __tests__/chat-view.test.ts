import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { Component, MarkdownRenderer, MarkdownView, Modal } from 'obsidian';
import type { ChatAgentStatus, ChatMessage, StreamLLMOptions } from '../src/ai-services/chat-service';
import type { AgentEvent, PaAgentMessage } from '../src/ai-services/chat-types';
import { CHAT_MENU_IDLE_CLOSE_MS, LLMView } from '../src/chat/chat-view';
import { getDistinctChatHistoryPreview } from '../src/chat/modals';
import { getChatRoleIdenticonModel } from '../src/chat/role-identicons';
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
        removeProperty: (name: string) => {
            const value = this.style.values.get(name) ?? '';
            this.style.values.delete(name);
            return value;
        },
        getPropertyValue: (name: string) => this.style.values.get(name) ?? '',
    };
    parentElement: MockElement | null = null;
    isConnected = true;
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

    private _className = '';

    constructor(tagName: string) {
        this.tagName = tagName.toLowerCase();
    }

    get className() {
        return this._className;
    }

    set className(value: string) {
        this._className = value;
        for (const cls of value.split(/\s+/).filter(Boolean)) {
            this.classList.add(cls);
        }
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

    removeEventListener(type: string, listener: (event: unknown) => void) {
        const listeners = this.listeners.get(type);
        if (!listeners) return;
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.removeChild(this);
        }
    }

    closest(selector: string): MockElement | null {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: MockElement | null = this.parentElement;
        while (current) {
            if (matchesSelector(current, selector)) return current;
            current = current.parentElement;
        }
        return null;
    }

    querySelector<T extends MockElement = MockElement>(selector: string): T | null {
        return walk(this, (el) => el !== this && matchesSelector(el, selector)) as T | null;
    }

    dispatchEvent(type: string, event: unknown = {}) {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
        }
        if (type === 'keydown' && this.onkeydown) {
            this.onkeydown(event as { key: string; preventDefault: () => void });
        }
    }

    focus() {
        const documentLike = globalThis.document as unknown as { activeElement?: MockElement } | undefined;
        if (documentLike && typeof documentLike === 'object') {
            documentLike.activeElement = this;
        }
    }

    click() {
        if (this.disabled) return undefined;
        const event = {
            target: this,
            currentTarget: this,
            stopPropagation: () => { },
            preventDefault: () => { },
            defaultPrevented: false,
        };
        this.dispatchEvent('click', event);
        if (!this.onclick) return undefined;
        return this.onclick(event);
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
        if (selector === '.mermaid, .block-language-mermaid') {
            return walkAll(this, (el) =>
                el.classList.contains('mermaid') || el.classList.contains('block-language-mermaid')
            );
        }
        if (selector === 'svg') {
            return walkAll(this, (el) => el.tagName === 'svg');
        }
        if (selector === '.callout[data-callout="personal-assistant-ai"]') {
            return walkAll(this, (el) =>
                el.classList.contains('callout') && el.getAttribute('data-callout') === 'personal-assistant-ai'
            );
        }
        if (selector === 'a.internal-link') {
            return walkAll(this, (el) => el.tagName === 'a' && el.classList.contains('internal-link'));
        }
        if (selector.startsWith('.') && !selector.includes(',') && !selector.includes(' ')) {
            return walkAll(this, (el) => el.classList.contains(selector.slice(1)));
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

function matchesSelector(el: MockElement, selector: string): boolean {
    if (selector.startsWith('.')) {
        return el.classList.contains(selector.slice(1));
    }
    if (selector.startsWith('[data-type=')) {
        const value = selector.match(/\[data-type="(.+)"\]/)?.[1];
        return value ? el.getAttribute('data-type') === value : false;
    }
    return el.tagName === selector;
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

function getCssRuleBlock(css: string, selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) {
        throw new Error(`CSS rule not found: ${selector}`);
    }
    const blockStart = css.indexOf('{', start);
    const blockEnd = css.indexOf('\n}', blockStart);
    if (blockStart === -1 || blockEnd === -1) {
        throw new Error(`CSS rule block not found: ${selector}`);
    }
    return css.slice(blockStart + 1, blockEnd);
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

function emitCanonical(call: StreamCall, event: AgentEvent) {
    call.options.onLifecycleEvent?.(event);
}

function canonicalEvent(overrides: Partial<AgentEvent> & { type: AgentEvent['type'] }): AgentEvent {
    return {
        version: 2,
        runId: 'run_ui_1',
        turnId: overrides.type === 'agent_start' || overrides.type === 'agent_end' ? '__run__' : 'turn_1',
        scope: overrides.type === 'agent_start' || overrides.type === 'agent_end' ? 'run' : 'turn',
        seq: 1,
        timestamp: 100,
        ...overrides,
    } as AgentEvent;
}

function assistantMessage(
    id: string,
    content: Extract<PaAgentMessage, { role: 'assistant' }>['content'],
): Extract<PaAgentMessage, { role: 'assistant' }> {
    return {
        role: 'assistant',
        id,
        content,
        timestamp: 100,
    };
}

function toolResultMessage(
    id: string,
    overrides: Partial<Extract<PaAgentMessage, { role: 'toolResult' }>> = {},
): Extract<PaAgentMessage, { role: 'toolResult' }> {
    return {
        role: 'toolResult',
        id,
        toolCallId: 'call_memory',
        toolName: 'search_memory',
        isError: false,
        timestamp: 100,
        content: {
            promptText: '{"tool":"search_memory","status":"ok"}',
            previewText: 'Selected Memory: launch.md',
            includeInNextPrompt: true,
            sourceRecords: [{
                kind: 'memory-reference',
                dedupKey: 'memory:launch.md',
                path: 'memory/launch.md',
                sourceBoundary: 'memory',
                citationEligible: true,
            }],
            contextUsed: [{
                category: 'memory',
                label: 'Selected Memory',
                detail: '1 selected note',
                sources: [{ path: 'memory/launch.md' }],
                citationEligible: true,
            }],
        },
        ...overrides,
    };
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

function createView(options: { withMarkdownLeaf?: boolean; panelWidth?: number; chatHistoryManager?: unknown } = {}) {
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
            skillContextEnabled: true,
            enabledSkillIds: [
                'obsidian-markdown',
                'obsidian-bases',
                'json-canvas',
                'pa-frontmatter-audit',
                'pa-callout-cleanup',
                'pa-vault-link-health',
                'pa-plugin-config-review',
            ],
        },
        chatHistoryManager: options.chatHistoryManager,
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
        Object.defineProperty(globalThis, 'MutationObserver', {
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

    it('recovers through the normal send path after a cancelled turn settles', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        const textArea = getTextArea(containerEl);
        textArea.value = 'cancel smoke prompt';
        const askButton = getButtonByText(containerEl, 'Ask');
        void askButton.click();
        await flushPromises();

        expect(streamCalls).toHaveLength(1);
        getButtonByClass(containerEl, 'cancel-button').click();
        streamCalls[0].reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).toContain('Generation cancelled');
        textArea.value = 'after cancel recovery prompt';
        expect(askButton.disabled).toBe(false);
        void askButton.click();
        await flushPromises();

        expect(streamCalls).toHaveLength(2);
        expect(streamCalls[1].prompt).toBe('after cancel recovery prompt');
        expect(streamCalls[1].chatHistory).toEqual([]);
        streamCalls[1].onChunk('PA_CANCEL_RECOVERY_OK');
        streamCalls[1].resolve();
        await flushPromises();
        await flushPromises();
        runAnimationFrames(true);

        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'after cancel recovery prompt' },
            { role: 'assistant', content: 'PA_CANCEL_RECOVERY_OK' },
        ]);
        expect(allText(containerEl)).toContain('after cancel recovery prompt');
        expect(allText(containerEl)).toContain('PA_CANCEL_RECOVERY_OK');
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
        const userRole = getElementByClass(liveUserMessage, 'message-role');
        const userIdenticon = getElementByClass(userRole, 'pa-chat-role-identicon-user');
        expect(userIdenticon.tagName).toBe('span');
        expect(userIdenticon.getAttribute('aria-hidden')).toBe('true');
        expect(userIdenticon.style.getPropertyValue('--pa-chat-role-identicon-fill')).toMatch(/^var\(--pa-chat-role-identicon-/);
        const userIdenticonSvg = getElementByClass(userIdenticon, 'pa-chat-role-identicon-svg');
        expect(userIdenticonSvg.tagName).toBe('svg');
        expect(userIdenticonSvg.getAttribute('shape-rendering')).toBe('crispEdges');
        expect(userIdenticonSvg.getAttribute('fill')).toBe('none');
        expect(getElementsByClass(userIdenticon, 'pa-chat-role-identicon-cell').length).toBeGreaterThan(0);
        expect(getElementsByClass(userIdenticon, 'pa-chat-role-identicon-empty-scan')).toHaveLength(0);
        expect(userRole.children[0]).toBe(userIdenticon);
        const assistantRole = getElementByClass(liveAssistantMessages[0], 'message-role');
        const assistantIdenticon = getElementByClass(assistantRole, 'pa-chat-role-identicon-assistant');
        const assistantLoader = getElementByClass(assistantRole, 'pa-chat-role-loader-assistant');
        expect(assistantIdenticon.tagName).toBe('span');
        expect(assistantIdenticon.classList.contains('pa-chat-role-identicon-active')).toBe(true);
        expect(assistantIdenticon.style.getPropertyValue('--pa-chat-role-identicon-fill')).toMatch(/^var\(--pa-chat-role-identicon-/);
        const assistantIdenticonSvg = getElementByClass(assistantIdenticon, 'pa-chat-role-identicon-svg');
        expect(assistantIdenticonSvg.tagName).toBe('svg');
        expect(assistantIdenticonSvg.getAttribute('shape-rendering')).toBe('crispEdges');
        expect(getElementsByClass(assistantIdenticon, 'pa-chat-role-identicon-filled-scan').length).toBeGreaterThan(0);
        expect(getElementsByClass(assistantIdenticon, 'pa-chat-role-identicon-empty-scan').length).toBeGreaterThan(0);
        expect(getElementsByClass(assistantIdenticon, 'pa-chat-role-identicon-cell')).toHaveLength(25);
        expect(assistantRole.children[0]).toBe(assistantIdenticon);
        expect(assistantRole.children[2]).toBe(assistantLoader);
        expect(walk(liveAssistantMessages[0], (el) => el.tagName === 'l-bouncy-arc')).not.toBeNull();
        expect(liveUserMessage.classList.contains('llm-message-enter')).toBe(true);
        expect(liveAssistantMessage.classList.contains('llm-message-enter')).toBe(true);

        streamCalls[0].onChunk('partial answer');
        await flushPromises();
        await flushPromises();
        runAnimationFrames();
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
        expect(assistantIdenticon.classList.contains('pa-chat-role-identicon-active')).toBe(false);
        expect(getElementsByClass(assistantIdenticon, 'pa-chat-role-identicon-empty-scan')).toHaveLength(0);
        expect(getElementsByClass(assistantIdenticon, 'pa-chat-role-identicon-filled-scan')).toHaveLength(0);
        expect(getButtonsByClass(containerEl, 'delete-message-button')).toHaveLength(2);
        expect(getButtonsByClass(containerEl, 'add-to-editor-message-button')).toHaveLength(1);
    });

    it('defers live Mermaid rendering and wraps the final diagram with a viewer button', async () => {
        const renderedMarkdown: string[] = [];
        let openedModal: { modalEl: MockElement; contentEl: MockElement } | null = null;
        const modalOpenSpy = jest.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
            const modal = this as unknown as { modalEl: MockElement; contentEl: MockElement; onOpen: () => void };
            modal.modalEl = new MockElement('div');
            modal.contentEl = new MockElement('div');
            openedModal = { modalEl: modal.modalEl, contentEl: modal.contentEl };
            modal.onOpen();
        });
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createElement: (tagName: string) => new MockElement(tagName),
            },
        });
        (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
            renderedMarkdown.push(markdown);
            if (markdown.includes('```mermaid') && !markdown.includes('A --> B')) {
                throw new Error('incomplete Mermaid');
            }
            el.setText(markdown);
            if (markdown.includes('```mermaid')) {
                el.createDiv({ cls: 'block-language-mermaid' });
            }
        });
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'draw a graph';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        streamCalls[0].onChunk('```mermaid\ngraph TD\nA -->');
        await flushPromises();
        await flushPromises();
        runAnimationFrames();
        await flushPromises();

        expect(renderedMarkdown[renderedMarkdown.length - 1]).toContain('```text');
        expect(renderedMarkdown[renderedMarkdown.length - 1]).not.toContain('```mermaid');
        expect(allText(containerEl)).not.toContain('Could not render message');

        streamCalls[0].onChunk('```mermaid\ngraph TD\nA --> B\n```');
        await flushPromises();
        await flushPromises();
        runAnimationFrames();
        await flushPromises();

        expect(renderedMarkdown[renderedMarkdown.length - 1]).toContain('```text');

        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(renderedMarkdown[renderedMarkdown.length - 1]).toContain('```mermaid');
        expect(getElementByClass(containerEl, 'pa-chat-mermaid-shell')).toBeTruthy();
        expect(getElementByClass(containerEl, 'pa-chat-mermaid-viewport')).toBeTruthy();
        const openButtons = getButtonsByClass(containerEl, 'pa-chat-mermaid-open-button');
        expect(openButtons).toHaveLength(1);
        openButtons[0].click();
        await flushPromises();

        expect(modalOpenSpy).toHaveBeenCalled();
        expect(openedModal).not.toBeNull();
        const modal = openedModal as unknown as { modalEl: MockElement; contentEl: MockElement };
        expect(modal.modalEl.getAttribute('aria-labelledby')).toMatch(/^pa-chat-mermaid-modal-title-/);
        expect(getElementByClass(modal.contentEl, 'pa-chat-mermaid-modal-viewport')).toBeTruthy();
        expect(renderedMarkdown[renderedMarkdown.length - 1]).toContain('```mermaid');
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'draw a graph' },
            { role: 'assistant', content: '```mermaid\ngraph TD\nA --> B\n```' },
        ]);
        modalOpenSpy.mockRestore();
    });

    it('wraps Mermaid containers that appear after the rendered buffer is attached', async () => {
        const mermaidBuffer: { current: MockElement | null } = { current: null };
        const mutationCallbacks: MutationCallback[] = [];
        class MockMutationObserver {
            readonly observe = jest.fn();
            readonly disconnect = jest.fn();

            constructor(callback: MutationCallback) {
                mutationCallbacks.push(callback);
            }
        }
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createElement: (tagName: string) => new MockElement(tagName),
            },
        });
        Object.defineProperty(globalThis, 'MutationObserver', {
            configurable: true,
            value: MockMutationObserver,
        });
        (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
            el.setText(markdown);
            if (markdown.includes('```mermaid')) {
                mermaidBuffer.current = el;
            }
        });
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'draw a graph';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        streamCalls[0].onChunk('```mermaid\ngraph TD\nA --> B\n```');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementsByClass(containerEl, 'pa-chat-mermaid-shell')).toHaveLength(0);
        expect(mutationCallbacks).toHaveLength(1);
        runAnimationFrames();
        runAnimationFrames();
        runAnimationFrames();
        await flushPromises();
        expect(getElementsByClass(containerEl, 'pa-chat-mermaid-shell')).toHaveLength(0);

        expect(mermaidBuffer.current).not.toBeNull();
        const attachedMermaidBuffer = mermaidBuffer.current;
        if (!attachedMermaidBuffer) throw new Error('Mermaid buffer was not captured');
        const mermaidDiagram = attachedMermaidBuffer.createDiv({ cls: 'block-language-mermaid' });
        mutationCallbacks[0]([
            {
                type: 'childList',
                target: attachedMermaidBuffer,
                addedNodes: [mermaidDiagram],
            } as unknown as MutationRecord,
        ], {} as MutationObserver);
        await flushPromises();
        expect(getElementsByClass(containerEl, 'pa-chat-mermaid-shell')).toHaveLength(0);
        runAnimationFrames();
        await flushPromises();

        expect(getElementsByClass(containerEl, 'pa-chat-mermaid-shell')).toHaveLength(1);
        expect(getButtonsByClass(containerEl, 'pa-chat-mermaid-open-button')).toHaveLength(1);
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'draw a graph' },
            { role: 'assistant', content: '```mermaid\ngraph TD\nA --> B\n```' },
        ]);
    });

    it('maps multiple Mermaid viewer buttons to the matching source', async () => {
        const renderedMarkdown: string[] = [];
        let openedModal: { modalEl: MockElement; contentEl: MockElement } | null = null;
        const modalOpenSpy = jest.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
            const modal = this as unknown as { modalEl: MockElement; contentEl: MockElement; onOpen: () => void };
            modal.modalEl = new MockElement('div');
            modal.contentEl = new MockElement('div');
            openedModal = { modalEl: modal.modalEl, contentEl: modal.contentEl };
            modal.onOpen();
        });
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createElement: (tagName: string) => new MockElement(tagName),
            },
        });
        (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
            renderedMarkdown.push(markdown);
            el.setText(markdown);
            const mermaidFenceCount = markdown.match(/```mermaid/g)?.length ?? 0;
            for (let index = 0; index < mermaidFenceCount; index += 1) {
                const wrapper = el.createDiv({ cls: 'block-language-mermaid' });
                wrapper.createDiv({ cls: 'mermaid' });
            }
        });
        const { view, containerEl } = createView();
        await view.onOpen();

        const response = [
            '```mermaid',
            'graph TD',
            'A --> B',
            '```',
            '',
            '```mermaid',
            'graph TD',
            'B --> C',
            '```',
        ].join('\n');
        getTextArea(containerEl).value = 'draw two graphs';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        streamCalls[0].onChunk(response);
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const openButtons = getButtonsByClass(containerEl, 'pa-chat-mermaid-open-button');
        expect(openButtons).toHaveLength(2);
        openButtons[1].click();
        await flushPromises();

        expect(modalOpenSpy).toHaveBeenCalledTimes(1);
        expect(openedModal).not.toBeNull();
        expect(renderedMarkdown[renderedMarkdown.length - 1]).toContain('B --> C');
        expect(renderedMarkdown[renderedMarkdown.length - 1]).not.toContain('A --> B');
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'draw two graphs' },
            { role: 'assistant', content: response },
        ]);
        modalOpenSpy.mockRestore();
    });

    it('waits for all Mermaid candidates before binding multiple preview sources', async () => {
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createElement: (tagName: string) => new MockElement(tagName),
            },
        });
        (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
            el.setText(markdown);
            if (markdown.includes('```mermaid')) {
                el.createDiv({ cls: 'block-language-mermaid' });
            }
        });
        const { view, containerEl } = createView();
        await view.onOpen();

        const response = [
            '```mermaid',
            'graph TD',
            'A --> B',
            '```',
            '',
            '```mermaid',
            'graph TD',
            'B --> C',
            '```',
        ].join('\n');
        getTextArea(containerEl).value = 'draw two graphs';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        streamCalls[0].onChunk(response);
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(getButtonsByClass(containerEl, 'pa-chat-mermaid-open-button')).toHaveLength(0);
        runAnimationFrames();
        runAnimationFrames();
        await flushPromises();
        expect(getButtonsByClass(containerEl, 'pa-chat-mermaid-open-button')).toHaveLength(0);
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'draw two graphs' },
            { role: 'assistant', content: response },
        ]);
    });

    it('does not rerender completed non-Mermaid answers after streaming', async () => {
        const renderedMarkdown: string[] = [];
        (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
            renderedMarkdown.push(markdown);
            el.setText(markdown);
        });
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'plain answer prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('plain answer');
        await flushPromises();
        await flushPromises();
        runAnimationFrames();
        await flushPromises();
        expect(allText(containerEl)).toContain('plain answer');
        const renderCountAfterChunk = renderedMarkdown.length;

        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(renderedMarkdown).toHaveLength(renderCountAfterChunk);
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'plain answer prompt' },
            { role: 'assistant', content: 'plain answer' },
        ]);
    });

    it('falls back to Mermaid source when final Mermaid rendering throws synchronously', async () => {
        const renderedMarkdown: string[] = [];
        (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
            renderedMarkdown.push(markdown);
            if (markdown.includes('```mermaid')) {
                throw new Error('Mermaid render failed');
            }
            el.setText(markdown);
        });
        const { view, containerEl } = createView();
        await view.onOpen();

        const content = '```mermaid\ngraph TD\nA --> B\n```';
        getTextArea(containerEl).value = 'broken graph';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk(content);
        await flushPromises();
        await flushPromises();

        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(renderedMarkdown.some((markdown) => markdown.includes('```mermaid'))).toBe(true);
        expect(renderedMarkdown[renderedMarkdown.length - 1]).toContain('```text');
        expect(allText(containerEl)).toContain('Mermaid diagram could not be rendered; showing source.');
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'broken graph' },
            { role: 'assistant', content },
        ]);
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

    it('unloads assistant markdown render owners when a streamed answer becomes a terminal row', async () => {
        const unloadSpy = jest.spyOn(Component.prototype, 'unload');
        try {
            const { view, containerEl } = createView();
            await view.onOpen();

            getTextArea(containerEl).value = 'cancel after partial render';
            void getButtonByText(containerEl, 'Ask').click();
            await flushPromises();

            streamCalls[0].onChunk('partial **answer**');
            await flushPromises();
            await flushPromises();
            expect(getElementsByClass(containerEl, 'assistant')).toHaveLength(1);
            expect((view as any).markdownRenderOwners.size).toBeGreaterThanOrEqual(2); // eslint-disable-line @typescript-eslint/no-explicit-any

            getButtonByClass(containerEl, 'cancel-button').click();
            streamCalls[0].reject(new DOMException('Aborted', 'AbortError'));
            await flushPromises();
            await flushPromises();

            expect(getElementsByClass(containerEl, 'assistant')).toHaveLength(0);
            expect(allText(containerEl)).toContain('Generation cancelled');
            expect((view as any).markdownRenderOwners.size).toBe(1); // eslint-disable-line @typescript-eslint/no-explicit-any
            expect(unloadSpy).toHaveBeenCalled();
        } finally {
            unloadSpy.mockRestore();
        }
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
        runAnimationFrames();
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

    it('renders canonical lifecycle phases without duplicate legacy chunks', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'use memory before answering';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        const call = streamCalls[0];
        const responseDiv = getResponseDiv(view);
        emitCanonical(call, canonicalEvent({ type: 'agent_start', scope: 'run', turnId: '__run__' }));
        emitCanonical(call, canonicalEvent({ type: 'turn_start', turnId: 'turn_1', scope: 'turn' }));
        const userMessage: Extract<PaAgentMessage, { role: 'user' }> = {
            role: 'user',
            id: 'user_1',
            content: 'use memory before answering',
            timestamp: 100,
        };
        emitCanonical(call, canonicalEvent({ type: 'message_start', turnId: 'turn_1', scope: 'turn', message: userMessage }));
        emitCanonical(call, canonicalEvent({ type: 'message_end', turnId: 'turn_1', scope: 'turn', message: userMessage }));
        const firstAssistant = assistantMessage('assistant_1', []);
        emitCanonical(call, canonicalEvent({ type: 'message_start', turnId: 'turn_1', scope: 'turn', message: firstAssistant }));
        emitCanonical(call, canonicalEvent({
            type: 'message_update',
            turnId: 'turn_1',
            scope: 'turn',
            messageId: 'assistant_1',
            update: { kind: 'text_delta', text: 'Draft answer before tools.' },
        }));
        await flushPromises();
        await flushPromises();
        runAnimationFrames();
        await flushPromises();

        expect(allText(getElementByClass(responseDiv, 'assistant'))).toContain('Draft answer before tools.');
        call.onChunk('legacy duplicate snapshot');
        await flushPromises();
        await flushPromises();
        expect(allText(responseDiv)).not.toContain('legacy duplicate snapshot');

        emitCanonical(call, canonicalEvent({
            type: 'message_update',
            turnId: 'turn_1',
            scope: 'turn',
            messageId: 'assistant_1',
            update: { kind: 'toolcall_start', toolCallId: 'call_memory', name: 'search_memory', index: 0 },
            metadata: { reclassifiedPendingText: 'Draft answer before tools.' },
        }));
        await flushPromises();
        await flushPromises();

        expect(allText(getElementByClass(responseDiv, 'assistant'))).not.toContain('Draft answer before tools.');
        expect(allText(responseDiv)).toContain('Draft before tool use: Draft answer before tools.');

        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            turnId: 'turn_1',
            scope: 'turn',
            message: assistantMessage('assistant_1', [
                { type: 'thinking', text: 'Draft answer before tools.' },
                { type: 'toolCall', id: 'call_memory', name: 'search_memory', input: { query: 'launch' }, index: 0 },
            ]),
        }));
        emitCanonical(call, canonicalEvent({
            type: 'tool_execution_start',
            turnId: 'turn_1',
            scope: 'turn',
            toolCallId: 'call_memory',
            toolName: 'search_memory',
            input: { query: 'launch' },
        }));
        emitCanonical(call, canonicalEvent({
            type: 'tool_execution_end',
            turnId: 'turn_1',
            scope: 'turn',
            toolCallId: 'call_memory',
            toolName: 'search_memory',
            outcome: 'success',
        }));
        const toolResult = toolResultMessage('tool_result_1');
        emitCanonical(call, canonicalEvent({
            type: 'message_start',
            turnId: 'turn_1',
            scope: 'turn',
            message: toolResult,
        }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            turnId: 'turn_1',
            scope: 'turn',
            message: toolResult,
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end',
            turnId: 'turn_1',
            scope: 'turn',
            status: 'tool_results_ready',
            toolResults: [toolResult],
        }));
        emitCanonical(call, canonicalEvent({ type: 'turn_start', turnId: 'turn_2', scope: 'turn' }));
        const finalAssistant = assistantMessage('assistant_2', []);
        emitCanonical(call, canonicalEvent({
            type: 'message_start',
            turnId: 'turn_2',
            scope: 'turn',
            message: finalAssistant,
        }));
        emitCanonical(call, canonicalEvent({
            type: 'message_update',
            turnId: 'turn_2',
            scope: 'turn',
            messageId: 'assistant_2',
            update: { kind: 'text_delta', text: 'Final answer from Memory.' },
        }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            turnId: 'turn_2',
            scope: 'turn',
            message: assistantMessage('assistant_2', [{ type: 'text', text: 'Final answer from Memory.' }]),
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end',
            turnId: 'turn_2',
            scope: 'turn',
            status: 'completed',
        }));
        emitCanonical(call, canonicalEvent({
            type: 'agent_end',
            scope: 'run',
            turnId: '__run__',
            status: 'completed',
            metadata: { finalTurnId: 'turn_2' },
        }));
        call.resolve();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toHaveLength(2);
        expect(view.chatHistory[1]).toMatchObject({
            role: 'assistant',
            content: 'Final answer from Memory.',
            memoryMetadata: {
                hasMemoryContent: true,
                allowedMemorySourcePaths: ['memory/launch.md'],
            },
        });
        expect(view.chatHistory[1].canonicalTurn?.runId).toBe('run_ui_1');
        expect(view.chatHistory[1].canonicalTurn?.turnId).toBe('turn_2');
        expect(allText(responseDiv)).toContain('Context Used');
        expect(allText(responseDiv)).toContain('Selected Memory');
        expect(allText(getElementByClass(responseDiv, 'assistant'))).toContain('Final answer from Memory.');
        expect(allText(getElementByClass(responseDiv, 'assistant'))).not.toContain('legacy duplicate snapshot');
    });

    it('renders canonical host pre-context as Context Used and persists it with history', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'check unresolved wikilinks';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        const call = streamCalls[0];
        const responseDiv = getResponseDiv(view);
        const hostContext = {
            skills: [{
                id: 'pa-vault-link-health',
                content: 'Use bounded read-only vault link checks.',
            }],
            contextUsed: [{
                category: 'skill-guide',
                label: 'pa-vault-link-health',
                sources: [{ path: 'skills/pa-vault-link-health/SKILL.md' }],
                citationEligible: false,
            }],
            sourceRecords: [{
                kind: 'skill-guide',
                dedupKey: 'skill:pa-vault-link-health',
                providerId: 'skill-context',
                capabilityName: 'skill-context',
                sourceBoundary: 'skill-context',
                title: 'pa-vault-link-health',
                citationEligible: false,
                statusOnly: true,
            }],
        };
        emitCanonical(call, canonicalEvent({ type: 'agent_start', runId: 'run_skill_1', scope: 'run', turnId: '__run__' }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_start',
            runId: 'run_skill_1',
            turnId: 'turn_skill_1',
            scope: 'turn',
            metadata: { hostContext },
        }));
        const userMessage: Extract<PaAgentMessage, { role: 'user' }> = {
            role: 'user',
            id: 'user_skill_1',
            content: 'check unresolved wikilinks',
            timestamp: 100,
        };
        emitCanonical(call, canonicalEvent({
            type: 'message_start',
            runId: 'run_skill_1',
            turnId: 'turn_skill_1',
            scope: 'turn',
            message: userMessage,
        }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            runId: 'run_skill_1',
            turnId: 'turn_skill_1',
            scope: 'turn',
            message: userMessage,
        }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            runId: 'run_skill_1',
            turnId: 'turn_skill_1',
            scope: 'turn',
            message: assistantMessage('assistant_skill_1', [
                { type: 'toolCall', id: 'call_memory_skill', name: 'search_memory', input: { query: 'wikilinks' }, index: 0 },
            ]),
        }));
        emitCanonical(call, canonicalEvent({
            type: 'tool_execution_start',
            runId: 'run_skill_1',
            turnId: 'turn_skill_1',
            scope: 'turn',
            toolCallId: 'call_memory_skill',
            toolName: 'search_memory',
            input: { query: 'wikilinks' },
        }));
        emitCanonical(call, canonicalEvent({
            type: 'tool_execution_end',
            runId: 'run_skill_1',
            turnId: 'turn_skill_1',
            scope: 'turn',
            toolCallId: 'call_memory_skill',
            toolName: 'search_memory',
            outcome: 'success',
        }));
        const memoryToolResult = toolResultMessage('tool_result_skill_memory');
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            runId: 'run_skill_1',
            turnId: 'turn_skill_1',
            scope: 'turn',
            message: memoryToolResult,
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end',
            runId: 'run_skill_1',
            turnId: 'turn_skill_1',
            scope: 'turn',
            status: 'tool_results_ready',
            toolResults: [memoryToolResult],
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_start',
            runId: 'run_skill_1',
            turnId: 'turn_skill_2',
            scope: 'turn',
            metadata: { hostContext },
        }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            runId: 'run_skill_1',
            turnId: 'turn_skill_2',
            scope: 'turn',
            message: assistantMessage('assistant_skill_2', [{ type: 'text', text: 'Use the link-health workflow.' }]),
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end',
            runId: 'run_skill_1',
            turnId: 'turn_skill_2',
            scope: 'turn',
            status: 'completed',
        }));
        emitCanonical(call, canonicalEvent({
            type: 'agent_end',
            runId: 'run_skill_1',
            scope: 'run',
            turnId: '__run__',
            status: 'completed',
            metadata: { finalTurnId: 'turn_skill_2' },
        }));
        call.resolve();
        await flushPromises();
        await flushPromises();

        expect(allText(responseDiv)).toContain('Context Used');
        expect(allText(responseDiv)).toContain('pa-vault-link-health');
        const canonicalTurn = view.chatHistory[1].canonicalTurn;
        expect(canonicalTurn).toMatchObject({
            runId: 'run_skill_1',
            turnId: 'turn_skill_2',
            contextUsed: [expect.objectContaining({ category: 'skill-guide' })],
            sourceRecords: [expect.objectContaining({ kind: 'skill-guide' })],
        });
        const skillSourceRecords = canonicalTurn?.sourceRecords?.filter((record) => record.kind === 'skill-guide') ?? [];
        expect(skillSourceRecords).toHaveLength(1);
        expect(skillSourceRecords[0]).toMatchObject({ turnId: 'turn_skill_1' });
        expect(canonicalTurn?.messages.map((message) => message.role)).toEqual([
            'user',
            'assistant',
            'toolResult',
            'assistant',
        ]);
        expect(canonicalTurn?.messages.some((message) =>
            message.role === 'toolResult' && message.toolName === 'skill-context')).toBe(false);
        expect(view.chatHistory[1].memoryMetadata).toEqual(expect.objectContaining({
            hasMemoryContent: true,
            sourceRecords: expect.arrayContaining([expect.objectContaining({ kind: 'skill-guide' })]),
            contextUsed: expect.arrayContaining([expect.objectContaining({ category: 'skill-guide' })]),
        }));

        getTextArea(containerEl).value = 'second prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[1].onChunk('second answer');
        streamCalls[1].resolve();
        await flushPromises();
        await flushPromises();

        getButtonsByClass(containerEl, 'delete-message-button')[3].click();
        await flushPromises();
        await flushPromises();

        expect(allText(containerEl)).toContain('Context Used');
        expect(allText(containerEl)).toContain('pa-vault-link-health');
        expect(allText(containerEl)).toContain('Selected Memory');
    });

    it('renders canonical warning metadata outside the answer body and preserves it on redraw', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'answer with warning';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        const firstCall = streamCalls[0];
        emitCanonical(firstCall, canonicalEvent({ type: 'agent_start', runId: 'run_warn_1', scope: 'run', turnId: '__run__' }));
        emitCanonical(firstCall, canonicalEvent({ type: 'turn_start', runId: 'run_warn_1', turnId: 'turn_warn_1', scope: 'turn' }));
        emitCanonical(firstCall, canonicalEvent({
            type: 'message_end',
            runId: 'run_warn_1',
            turnId: 'turn_warn_1',
            scope: 'turn',
            message: assistantMessage('assistant_warn_1', [{ type: 'text', text: 'Answer from available context.' }]),
        }));
        emitCanonical(firstCall, canonicalEvent({
            type: 'turn_end',
            runId: 'run_warn_1',
            turnId: 'turn_warn_1',
            scope: 'turn',
            status: 'completed_with_warning',
        }));
        emitCanonical(firstCall, canonicalEvent({
            type: 'agent_end',
            runId: 'run_warn_1',
            scope: 'run',
            turnId: '__run__',
            status: 'completed_with_warning',
            metadata: {
                finalTurnId: 'turn_warn_1',
                warnings: [{
                    type: 'required_capability_missing',
                    message: 'Answer may be incomplete',
                    capability: 'webSearch',
                }],
            },
        }));
        firstCall.resolve();
        await flushPromises();
        await flushPromises();

        expect(allText(containerEl)).toContain('Answer may be incomplete');
        expect(allText(getElementByClass(getResponseDiv(view), 'assistant'))).not.toContain('Answer may be incomplete');
        expect(view.chatHistory[1].runtimeWarnings).toEqual([expect.objectContaining({
            type: 'required_capability_missing',
            capability: 'webSearch',
        })]);

        getTextArea(containerEl).value = 'second answer';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[1].onChunk('second answer body');
        streamCalls[1].resolve();
        await flushPromises();
        await flushPromises();

        const deleteButtons = getButtonsByClass(containerEl, 'delete-message-button');
        deleteButtons[3].click();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toHaveLength(2);
        expect(allText(containerEl)).toContain('Answer may be incomplete');
        expect(allText(containerEl)).not.toContain('second answer body');
    });

    it('renders canonical incomplete diagnostics without writing them into the answer body', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'answer with no final text';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        const call = streamCalls[0];
        const diagnostics = [{
            type: 'assistant_empty_response',
            message: 'Assistant stream ended after thinking without final answer text.',
        }];
        emitCanonical(call, canonicalEvent({ type: 'agent_start', runId: 'run_empty_1', scope: 'run', turnId: '__run__' }));
        emitCanonical(call, canonicalEvent({ type: 'turn_start', runId: 'run_empty_1', turnId: 'turn_empty_1', scope: 'turn' }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            runId: 'run_empty_1',
            turnId: 'turn_empty_1',
            scope: 'turn',
            message: assistantMessage('assistant_empty_1', [{ type: 'thinking', text: 'working' }]),
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end',
            runId: 'run_empty_1',
            turnId: 'turn_empty_1',
            scope: 'turn',
            status: 'incomplete',
            metadata: { diagnostics },
        }));
        emitCanonical(call, canonicalEvent({
            type: 'agent_end',
            runId: 'run_empty_1',
            scope: 'run',
            turnId: '__run__',
            status: 'incomplete',
            metadata: {
                finalTurnId: 'turn_empty_1',
                diagnostics,
            },
        }));
        call.resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementByClass(containerEl, 'thinking-status-summary').textContent).toBe('Answer incomplete');
        expect(getElementsByClass(containerEl, 'thinking-status-warning-item')).toHaveLength(1);
        expect(allText(containerEl)).toContain('No final answer was produced.');
        expect(allText(containerEl)).not.toContain('Assistant stream ended after thinking without final answer text.');
        expect(allText(getElementByClass(getResponseDiv(view), 'assistant'))).not.toContain('No final answer was produced.');
        expect(view.chatHistory[1]).toMatchObject({
            role: 'assistant',
            content: '',
            canonicalTurn: expect.objectContaining({ status: 'incomplete' }),
            runtimeWarnings: [expect.objectContaining({ type: 'assistant_empty_response' })],
        });
    });

    it('does not render canonical runtime instructions verbatim', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'answer with runtime instruction';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        const call = streamCalls[0];
        emitCanonical(call, canonicalEvent({ type: 'agent_start', runId: 'run_runtime_1', scope: 'run', turnId: '__run__' }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_start',
            runId: 'run_runtime_1',
            turnId: 'turn_runtime_1',
            scope: 'turn',
            metadata: {
                runtimeInstruction: 'SECRET_CORRECTIVE_RUNTIME_INSTRUCTION',
            },
        }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            runId: 'run_runtime_1',
            turnId: 'turn_runtime_1',
            scope: 'turn',
            message: assistantMessage('assistant_runtime_1', [{ type: 'text', text: 'Final answer.' }]),
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end',
            runId: 'run_runtime_1',
            turnId: 'turn_runtime_1',
            scope: 'turn',
            status: 'completed',
        }));
        emitCanonical(call, canonicalEvent({
            type: 'agent_end',
            runId: 'run_runtime_1',
            scope: 'run',
            turnId: '__run__',
            status: 'completed',
            metadata: { finalTurnId: 'turn_runtime_1' },
        }));
        call.resolve();
        await flushPromises();
        await flushPromises();

        expect(allText(getResponseDiv(view))).toContain('Continuing with tool results...');
        expect(allText(getResponseDiv(view))).not.toContain('SECRET_CORRECTIVE_RUNTIME_INSTRUCTION');
        expect(allText(getElementByClass(getResponseDiv(view), 'assistant'))).toContain('Final answer.');
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
        const redrawnUserMessage = getElementByClass(containerEl, 'user');
        const redrawnAssistantMessage = getElementByClass(containerEl, 'assistant');
        const redrawnUserRole = getElementByClass(redrawnUserMessage, 'message-role');
        const redrawnAssistantRole = getElementByClass(redrawnAssistantMessage, 'message-role');
        expect(getElementByClass(redrawnUserRole, 'pa-chat-role-identicon-user').tagName).toBe('span');
        expect(getElementByClass(redrawnAssistantRole, 'pa-chat-role-identicon-assistant').tagName).toBe('span');
        expect(redrawnUserMessage.getAttribute('aria-busy')).toBeNull();
        expect(redrawnAssistantMessage.getAttribute('aria-busy')).toBeNull();
    });

    it('restores persisted history with session role identicons', async () => {
        const restoredUser: ChatMessage = { role: 'user', content: 'restored prompt' };
        const restoredAssistant: ChatMessage = { role: 'assistant', content: 'restored answer' };
        const restoredEntry = {
            kind: 'history' as const,
            user: restoredUser,
            assistant: restoredAssistant,
        };
        const chatHistoryManager = {
            initialize: jest.fn(async () => undefined),
            isAvailable: jest.fn(() => true),
            getActiveConversationId: jest.fn(async () => 'conv_restored'),
            findConversation: jest.fn(async () => ({
                id: 'conv_restored',
                title: 'Restored',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                turnCount: 1,
                preview: 'restored prompt',
            })),
            getTurns: jest.fn(async () => [{
                conversationId: 'conv_restored',
                turnIndex: 0,
                user: { role: 'user' as const, content: 'restored prompt' },
                assistant: { role: 'assistant' as const, content: 'restored answer' },
            }]),
            deserializeTurn: jest.fn(() => ({
                userMessage: restoredUser,
                assistantMessage: restoredAssistant,
                historyEntry: restoredEntry,
            })),
            setActiveConversationId: jest.fn(async () => undefined),
        };
        const { view, containerEl } = createView({ chatHistoryManager });

        await view.onOpen();
        await flushPromises();
        await flushPromises();

        expect(chatHistoryManager.deserializeTurn).toHaveBeenCalledTimes(1);
        expect(view.chatHistory).toEqual([restoredUser, restoredAssistant]);
        const restoredUserMessage = getElementByClass(containerEl, 'user');
        const restoredAssistantMessage = getElementByClass(containerEl, 'assistant');
        const restoredUserRole = getElementByClass(restoredUserMessage, 'message-role');
        const restoredAssistantRole = getElementByClass(restoredAssistantMessage, 'message-role');
        expect(getElementByClass(restoredUserRole, 'pa-chat-role-identicon-user').tagName).toBe('span');
        expect(getElementByClass(restoredAssistantRole, 'pa-chat-role-identicon-assistant').tagName).toBe('span');
        expect(restoredUserMessage.getAttribute('aria-busy')).toBeNull();
        expect(restoredAssistantMessage.getAttribute('aria-busy')).toBeNull();
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

    it('coalesces overlapping live markdown renders before the final markdown render', async () => {
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
        expect(renderJobs.map((job) => job.markdown)).toEqual(['stream', 'old chunk']);
        expect(allText(containerEl)).not.toContain('old chunk');

        renderJobs[1].resolve();
        await flushPromises();
        expect(allText(containerEl)).not.toContain('old chunk');
        expect(renderJobs.map((job) => job.markdown)).toEqual(['stream', 'old chunk', 'new chunk']);

        renderJobs[2].resolve();
        await flushPromises();
        expect(allText(containerEl)).toContain('new chunk');
        expect(allText(containerEl)).not.toContain('old chunk');
    });

    it('uses a cost-aware latest-only drain after a slow synchronous live render', async () => {
        const { view, containerEl } = createView();
        const renderedMarkdown: string[] = [];
        let nowMs = 0;
        const performanceNowSpy = jest.spyOn(globalThis.performance, 'now').mockImplementation(() => nowMs);
        try {
            (MarkdownRenderer.render as jest.Mock).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
                renderedMarkdown.push(markdown);
                if (markdown.startsWith('slow')) {
                    nowMs += 20;
                }
                el.setText(markdown);
            });
            await view.onOpen();

            getTextArea(containerEl).value = 'cost prompt';
            void getButtonByText(containerEl, 'Ask').click();
            await flushPromises();

            streamCalls[0].onChunk('slow one');
            await flushPromises();
            await flushPromises();
            expect(renderedMarkdown).toEqual(['cost prompt', 'slow one']);
            expect(allText(containerEl)).toContain('slow one');

            streamCalls[0].onChunk('slow two');
            streamCalls[0].onChunk('slow three');
            await flushPromises();
            expect(renderedMarkdown).toEqual(['cost prompt', 'slow one']);
            expect(allText(containerEl)).not.toContain('slow three');

            nowMs = 52;
            await new Promise((resolve) => setTimeout(resolve, 40));
            await flushPromises();
            await flushPromises();

            expect(renderedMarkdown).toEqual(['cost prompt', 'slow one', 'slow three']);
            expect(renderedMarkdown).not.toContain('slow two');
            expect(allText(containerEl)).toContain('slow three');
        } finally {
            performanceNowSpy.mockRestore();
        }
    });

    it('reuses the in-flight final live markdown render before committing a successful turn', async () => {
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
        expect(renderJobs.map((job) => job.markdown)).toEqual(['async prompt', 'async answer']);
        expect(view.chatHistory).toEqual([]);
        expectHidden(getButtonByClass(containerEl, 'cancel-button'), 'cancel-button-visible', 'cancel-button-hidden');
        getButtonByClass(containerEl, 'cancel-button').click();
        expect(streamCalls[0].signal?.aborted).toBe(false);

        renderJobs[1].resolve();
        await flushPromises();
        await flushPromises();
        await flushPromises();

        expect(getElementByClass(containerEl, 'assistant')).toBe(assistantMessage);
        expect(view.chatHistory).toEqual([
            { role: 'user', content: 'async prompt' },
            { role: 'assistant', content: 'async answer' },
        ]);
        expect(allText(containerEl)).toContain('async answer');
    });

    it('restores cancel controls after clearing while final markdown rendering is in flight', async () => {
        const { view, containerEl } = createView();
        const renderJobs: Array<{ markdown: string; el: MockElement; resolve: () => void }> = [];
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

        getTextArea(containerEl).value = 'first prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('first answer');
        streamCalls[0].resolve();
        await flushPromises();
        expectHidden(getButtonByClass(containerEl, 'cancel-button'), 'cancel-button-visible', 'cancel-button-hidden');

        getButtonByText(containerEl, 'Clear Chat').click();
        await flushPromises();
        await flushPromises();
        expect(streamCalls[0].signal?.aborted).toBe(true);

        getTextArea(containerEl).value = 'second prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        expectVisible(getButtonByClass(containerEl, 'cancel-button'), 'cancel-button-visible', 'cancel-button-hidden');

        getButtonByClass(containerEl, 'cancel-button').click();
        expect(streamCalls[1].signal?.aborted).toBe(true);
        streamCalls[1].reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();

        renderJobs.find((job) => job.markdown === 'first answer')?.resolve();
        await flushPromises();
        expect(view.chatHistory).toEqual([]);
    });

    it('does not revive an in-flight assistant markdown render after cancellation', async () => {
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

        getTextArea(containerEl).value = 'cancel prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        const call = streamCalls[0];
        call.onChunk('partial **answer**');
        await flushPromises();

        getButtonByClass(containerEl, 'cancel-button').click();
        call.reject(new DOMException('Aborted', 'AbortError'));
        await flushPromises();
        await flushPromises();

        expect(allText(containerEl)).toContain('Generation cancelled');
        expect(allText(containerEl)).not.toContain('partial **answer**');
        expect(getButtonsByClass(containerEl, 'add-to-editor-message-button')).toHaveLength(0);

        renderJobs.find((job) => job.markdown === 'partial **answer**')?.resolve();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).toContain('Generation cancelled');
        expect(allText(containerEl)).not.toContain('partial **answer**');
        expect(getButtonsByClass(containerEl, 'add-to-editor-message-button')).toHaveLength(0);
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

    it('sizes role identicons for desktop and compact chat panes', () => {
        const css = readFileSync('src/custom.css', 'utf8');
        const assistantIdenticonModel = getChatRoleIdenticonModel('assistant');

        expect(css).toMatch(/\.llm-view\s+\.message-role\s*{[\s\S]*?--pa-chat-role-icon-size:\s*24px;[\s\S]*?--pa-chat-role-icon-padding:\s*2px;[\s\S]*?gap:\s*7px;/);
        expect(css).toMatch(/\.llm-view\s+\.pa-chat-role-identicon\s*{[\s\S]*?flex:\s*0 0 var\(--pa-chat-role-icon-size\);[\s\S]*?width:\s*var\(--pa-chat-role-icon-size\);[\s\S]*?height:\s*var\(--pa-chat-role-icon-size\);[\s\S]*?padding:\s*var\(--pa-chat-role-icon-padding\);/);
        expect(css).toMatch(/\.llm-view\.is-compact\s+\.message-role\s*{[\s\S]*?--pa-chat-role-icon-size:\s*26px;[\s\S]*?gap:\s*8px;/);
        expect(assistantIdenticonModel.viewBox).toBe('-3 -3 26 26');
        expect(assistantIdenticonModel.cellSize).toBe(4);
    });

    it('keeps role identicon shapes and palette colors stable by role seed', () => {
        const firstAssistantModel = getChatRoleIdenticonModel('assistant');
        const secondAssistantModel = getChatRoleIdenticonModel('assistant');
        const userModel = getChatRoleIdenticonModel('user');

        expect(firstAssistantModel.cells).toEqual(secondAssistantModel.cells);
        expect(firstAssistantModel.emptyCells).toEqual(secondAssistantModel.emptyCells);
        expect(userModel.cells).not.toEqual(firstAssistantModel.cells);
        expect(firstAssistantModel.fill).toBe('var(--pa-chat-role-identicon-purple)');
        expect(userModel.fill).toBe('var(--pa-chat-role-identicon-blue)');
        expect(firstAssistantModel.cells.length).toBeGreaterThan(0);
        expect(firstAssistantModel.cells.length + firstAssistantModel.emptyCells.length).toBe(25);
        for (const cell of firstAssistantModel.cells) {
            expect(cell.col).toBeGreaterThanOrEqual(0);
            expect(cell.col).toBeLessThan(5);
            expect(cell.row).toBeGreaterThanOrEqual(0);
            expect(cell.row).toBeLessThan(5);
            expect(cell.delayMs).toBe(cell.row * 280);
        }
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

    it('pins the Thinking status toggle so theme button defaults cannot add leading space', () => {
        const css = readFileSync('src/custom.css', 'utf8');
        const headerBlock = getCssRuleBlock(css, '.llm-view .thinking-status-header');
        const toggleBlock = getCssRuleBlock(css, '.llm-view .thinking-status-header > button.thinking-status-toggle');
        const toggleSvgBlock = getCssRuleBlock(css, '.llm-view .thinking-status-header > button.thinking-status-toggle > svg.svg-icon');
        const roleBlock = getCssRuleBlock(css, '.llm-view .thinking-status-role');

        expect(headerBlock).toContain('justify-content: flex-start;');
        expect(toggleBlock).toContain('appearance: none;');
        expect(toggleBlock).toContain('flex: 0 0 22px;');
        expect(toggleBlock).toContain('min-width: 22px;');
        expect(toggleBlock).toContain('max-width: 22px;');
        expect(toggleBlock).toContain('min-height: 22px;');
        expect(toggleBlock).toContain('max-height: 22px;');
        expect(toggleBlock).toContain('margin: 0;');
        expect(toggleBlock).toContain('padding: 2px;');
        expect(toggleSvgBlock).toContain('display: block;');
        expect(toggleSvgBlock).toContain('flex: 0 0 14px;');
        expect(toggleSvgBlock).toContain('min-width: 14px;');
        expect(toggleSvgBlock).toContain('max-width: 14px;');
        expect(toggleSvgBlock).toContain('min-height: 14px;');
        expect(toggleSvgBlock).toContain('max-height: 14px;');
        expect(toggleSvgBlock).toContain('stroke: currentColor;');
        expect(roleBlock).toContain('width: auto;');
        expect(roleBlock).toContain('max-width: none;');
    });

    it('keeps the chat composer in the visible flex area when mobile keyboards shrink the visual viewport', () => {
        const css = readFileSync('src/custom.css', 'utf8');
        const drawerInnerBlock = getCssRuleBlock(css, '.workspace-drawer-inner:has(.llm-view)');
        const mobileDrawerInnerBlock = getCssRuleBlock(css, 'body.is-mobile .workspace-drawer-inner:has(.llm-view)');
        const mobileViewBlock = getCssRuleBlock(css, 'body.is-mobile .llm-view');
        const mobileInputBlock = getCssRuleBlock(css, 'body.is-mobile .llm-input');
        const mobileTextareaBlock = getCssRuleBlock(css, 'body.is-mobile .llm-input textarea');
        const mobileButtonsBlock = getCssRuleBlock(css, 'body.is-mobile .llm-buttons');
        const mobileIconButtonBlock = getCssRuleBlock(css, 'body.is-mobile .llm-buttons button.pa-chat-icon-button');
        const mobileIconButtonHitAreaBlock = getCssRuleBlock(css, 'body.is-mobile .llm-buttons button.pa-chat-icon-button::before');
        const mobileIconButtonSvgBlock = getCssRuleBlock(css, 'body.is-mobile .llm-buttons button.pa-chat-icon-button svg');
        const mobileCompactInputBlock = getCssRuleBlock(css, 'body.is-mobile .llm-view.is-compact .llm-input');
        const mobileCompactTextareaBlock = getCssRuleBlock(css, 'body.is-mobile .llm-view.is-compact .llm-input textarea');
        const mobileKeyboardInputBlock = getCssRuleBlock(css, 'body.is-mobile .llm-view.is-keyboard-open .llm-input');
        const mobileKeyboardChatBlock = getCssRuleBlock(css, 'body.is-mobile .llm-view.is-keyboard-open .llm-chat-container');
        const mobileHandleBlock = getCssRuleBlock(css, 'body.is-mobile .pa-tab-bar-handle');
        const mobileLightHandleBlock = getCssRuleBlock(css, 'body.theme-light.is-mobile .pa-tab-bar-handle');
        const mobileDarkHandleBlock = getCssRuleBlock(css, 'body.theme-dark.is-mobile .pa-tab-bar-handle');
        const mobileExpandedHandleBlock = getCssRuleBlock(css, 'body.is-mobile .pa-tab-bar-handle[aria-expanded="true"]');
        const mobileHandleHitAreaBlock = getCssRuleBlock(css, 'body.is-mobile .pa-tab-bar-handle::before');
        const mobileHandleIconBlock = getCssRuleBlock(css, 'body.is-mobile .pa-tab-bar-handle svg');
        const mobileKeyboardHandleBlock = getCssRuleBlock(css, 'body.is-mobile .llm-view.is-keyboard-open .pa-tab-bar-handle');
        const mobileKeyboardHandleIconBlock = getCssRuleBlock(css, 'body.is-mobile .llm-view.is-keyboard-open .pa-tab-bar-handle svg');
        const keyboardSpacerBlock = getCssRuleBlock(css, '.pa-chat-keyboard-spacer');
        const mobileKeyboardSpacerBlock = getCssRuleBlock(css, 'body.is-mobile .pa-chat-keyboard-spacer');
        const mobileOpenKeyboardSpacerBlock = getCssRuleBlock(css, 'body.is-mobile .llm-view.is-keyboard-open .pa-chat-keyboard-spacer');

        expect(css).toMatch(/\.llm-view\s*{[\s\S]*?--pa-chat-keyboard-clearance:\s*0px;[\s\S]*?--pa-chat-keyboard-accessory-clearance:\s*0px;[\s\S]*?--pa-chat-keyboard-offset:\s*0px;[\s\S]*?--pa-chat-composer-height:\s*0px;[\s\S]*?--pa-chat-keyboard-motion:\s*180ms cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\);[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?padding:\s*0 0 var\(--pa-chat-keyboard-clearance,\s*0px\);[\s\S]*?position:\s*relative;/);
        expect(css).not.toMatch(/\.llm-view\s*{[^}]*transition:\s*padding-bottom/);
        expect(css).not.toMatch(/\.llm-view\.is-keyboard-open\s*{[\s\S]*?padding-bottom:\s*0;/);
        expect(drawerInnerBlock).toContain('padding-bottom: max(6px, env(safe-area-inset-bottom, 6px));');
        expect(mobileDrawerInnerBlock).toContain('--pa-chat-drawer-top-clearance: clamp(10px, calc(env(safe-area-inset-top, 0px) - 24px), 24px);');
        expect(mobileDrawerInnerBlock).toContain('padding-top: var(--pa-chat-drawer-top-clearance);');
        expect(mobileViewBlock).toContain('padding-bottom: 0;');
        expect(css).toMatch(/\.llm-chat-container\s*{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;/);
        expect(css).not.toMatch(/\.llm-chat-container\s*{[^}]*transition:\s*padding-bottom/);
        expect(css).toMatch(/\.llm-view\.is-keyboard-open\s+\.llm-chat-container\s*{[\s\S]*?padding-bottom:\s*calc\(14px \+ var\(--pa-chat-composer-height,\s*0px\)\);/);
        expect(css).toMatch(/\.pa-chat-empty-state\s*{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-height:\s*100%;/);
        expect(css).toMatch(/\.llm-input\s*{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?transform:\s*translate3d\(0,\s*0,\s*0\);[\s\S]*?transition:\s*transform var\(--pa-chat-keyboard-motion\);[\s\S]*?z-index:\s*3;/);
        const baseInputBlock = css.match(/(?:^|\n)\.llm-input\s*{[^}]*}/)?.[0] ?? '';
        expect(baseInputBlock).not.toContain('will-change: transform');
        expect(css).toMatch(/\.llm-view\.is-keyboard-open\s+\.llm-input\s*{[\s\S]*?position:\s*absolute;[\s\S]*?bottom:\s*0;[\s\S]*?transform:\s*translate3d\(0,\s*var\(--pa-chat-keyboard-offset,\s*0px\),\s*0\);[\s\S]*?will-change:\s*transform;[\s\S]*?z-index:\s*30;/);
        expect(mobileInputBlock).toContain('padding: 8px 8px calc(8px + var(--pa-chat-status-bar-clearance, 0px));');
        expect(mobileInputBlock).toContain('transition: none;');
        expect(mobileTextareaBlock).toContain('box-sizing: border-box;');
        expect(mobileTextareaBlock).toContain('height: 72px;');
        expect(mobileTextareaBlock).toContain('min-height: 72px;');
        expect(mobileTextareaBlock).toContain('max-height: min(26vh, 124px);');
        expect(mobileTextareaBlock).toContain('overflow-y: auto;');
        expect(mobileTextareaBlock).toContain('padding: 8px 10px 42px;');
        expect(mobileButtonsBlock).toContain('gap: 4px;');
        expect(mobileButtonsBlock).toContain('right: 7px;');
        expect(mobileButtonsBlock).toContain('bottom: 7px;');
        expect(mobileIconButtonBlock).toContain('width: 30px;');
        expect(mobileIconButtonBlock).toContain('height: 30px;');
        expect(mobileIconButtonBlock).toContain('flex: 0 0 30px;');
        expect(mobileIconButtonBlock).toContain('border-radius: 9px;');
        expect(mobileIconButtonHitAreaBlock).toContain('content: "";');
        expect(mobileIconButtonHitAreaBlock).toContain('inset: -7px;');
        expect(mobileIconButtonHitAreaBlock).toContain('border-radius: 14px;');
        expect(mobileIconButtonSvgBlock).toContain('width: 14px;');
        expect(mobileIconButtonSvgBlock).toContain('height: 14px;');
        expect(mobileCompactInputBlock).toContain('padding: 8px 8px calc(8px + var(--pa-chat-status-bar-clearance, 0px));');
        expect(mobileCompactTextareaBlock).toContain('height: 66px;');
        expect(mobileCompactTextareaBlock).toContain('min-height: 66px;');
        expect(mobileCompactTextareaBlock).toContain('max-height: min(26vh, 116px);');
        expect(mobileCompactTextareaBlock).toContain('padding-bottom: 40px;');
        expect(mobileKeyboardInputBlock).toContain('position: relative;');
        expect(mobileKeyboardInputBlock).toContain('bottom: auto;');
        expect(mobileKeyboardInputBlock).toContain('transform: translate3d(0, 0, 0);');
        expect(mobileKeyboardInputBlock).toContain('will-change: auto;');
        expect(mobileKeyboardInputBlock).toContain('z-index: 3;');
        expect(mobileKeyboardChatBlock).toContain('padding-bottom: 14px;');
        expect(mobileHandleBlock).toContain('--pa-tab-bar-handle-color: color-mix(in srgb, var(--text-normal) 72%, var(--text-muted));');
        expect(mobileHandleBlock).toContain('--pa-tab-bar-handle-expanded-color: color-mix(in srgb, var(--interactive-accent) 78%, var(--text-normal));');
        expect(mobileHandleBlock).toContain('position: relative;');
        expect(mobileHandleBlock).toContain('min-height: 20px;');
        expect(mobileHandleBlock).toContain('padding: 0;');
        expect(mobileHandleBlock).toContain('color: var(--pa-tab-bar-handle-color);');
        expect(mobileHandleBlock).toContain('opacity: 0.82;');
        expect(mobileLightHandleBlock).toContain('--pa-tab-bar-handle-color: color-mix(in srgb, var(--text-normal) 76%, var(--text-muted));');
        expect(mobileDarkHandleBlock).toContain('--pa-tab-bar-handle-color: color-mix(in srgb, var(--text-normal) 82%, var(--text-muted));');
        expect(mobileExpandedHandleBlock).toContain('color: var(--pa-tab-bar-handle-expanded-color);');
        expect(mobileExpandedHandleBlock).toContain('opacity: 0.92;');
        expect(mobileHandleHitAreaBlock).toContain('inset: -10px 0;');
        expect(mobileHandleIconBlock).toContain('width: 14px;');
        expect(mobileHandleIconBlock).toContain('height: 14px;');
        expect(mobileHandleIconBlock).toContain('stroke-width: 2.4px;');
        expect(mobileKeyboardHandleBlock).toContain('min-height: 12px;');
        expect(mobileKeyboardHandleIconBlock).toContain('width: 11px;');
        expect(mobileKeyboardHandleIconBlock).toContain('height: 11px;');
        expect(keyboardSpacerBlock).toContain('display: none;');
        expect(keyboardSpacerBlock).toContain('flex: 0 0 0px;');
        expect(keyboardSpacerBlock).toContain('height: 0;');
        expect(keyboardSpacerBlock).toContain('contain: layout paint size;');
        expect(keyboardSpacerBlock).not.toContain('transition:');
        expect(mobileKeyboardSpacerBlock).toContain('display: block;');
        expect(mobileKeyboardSpacerBlock).toContain('flex-basis: var(--pa-chat-keyboard-clearance, 0px);');
        expect(mobileKeyboardSpacerBlock).toContain('height: var(--pa-chat-keyboard-clearance, 0px);');
        expect(mobileOpenKeyboardSpacerBlock).toContain('flex-basis: var(--pa-chat-keyboard-clearance, 0px);');
        expect(mobileOpenKeyboardSpacerBlock).toContain('height: var(--pa-chat-keyboard-clearance, 0px);');
        expect(css).not.toMatch(/(?:^|\n)\.notice\s*{/);
        expect(css).toMatch(/\.pa-notice-shell\s*{[\s\S]*?background-color:\s*var\(--pa-background-primary\);/);
        expect(css).not.toMatch(/\.popover\s+\.popover-content\s*{[\s\S]*?width:\s*100% !important;/);
        expect(css).toMatch(/\.popover\.resize-popover-width\s+\.popover-content\s*{[\s\S]*?width:\s*var\(--resize-popover-width\) !important;/);
        expect(css).not.toMatch(/\.llm-view\.is-keyboard-native-fallback\s*{[\s\S]*?--pa-chat-keyboard-accessory-clearance:/);
        expect(css).not.toMatch(/\.is-keyboard-native-fallback\s+\.pa-chat-keyboard-spacer\s*{[\s\S]*?transition:/);
        expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*?\.llm-input\s*{[\s\S]*?transition:\s*none;/);
    });

    it('keeps Mermaid preview controls usable on narrow mobile panes', () => {
        const css = readFileSync('src/custom.css', 'utf8');

        expect(css).toMatch(/\.llm-view\s+\.pa-chat-mermaid-viewport\s*{[\s\S]*?-webkit-overflow-scrolling:\s*touch;[\s\S]*?overscroll-behavior:\s*contain;/);
        expect(css).toMatch(/\.llm-view\.is-narrow\s+\.pa-chat-mermaid-open-button\s*{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;[\s\S]*?min-width:\s*40px;[\s\S]*?min-height:\s*40px;/);
        expect(css).toMatch(/\.pa-chat-mermaid-modal-viewport\s*{[\s\S]*?-webkit-overflow-scrolling:\s*touch;[\s\S]*?overscroll-behavior:\s*contain;/);
    });

    it('keeps chat history rows inside the modal width on mobile', () => {
        const css = readFileSync('src/custom.css', 'utf8');

        expect(css).toMatch(/\.pa-chat-history-modal-shell\s*{[\s\S]*?width:\s*min\(720px,\s*calc\(100vw - 32px\)\);[\s\S]*?overflow-x:\s*hidden;/);
        expect(css).toMatch(/\.pa-chat-history-list\s*{[\s\S]*?list-style:\s*none;[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*hidden;/);
        expect(css).toMatch(/\.pa-chat-history-item\s*{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*44px;[\s\S]*?min-width:\s*0;/);
        expect(css).toMatch(/\.pa-chat-history-open\s*{[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;/);
        expect(css).toMatch(/\.pa-chat-history-title,\s*\n\.pa-chat-history-preview,\s*\n\.pa-chat-history-meta\s*{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-chat-history-modal-shell\s*{[\s\S]*?max-width:\s*calc\(100vw - 24px\);/);
    });

    it('hides chat history previews that duplicate the title', () => {
        expect(getDistinctChatHistoryPreview(
            '移动端 smoke： 请用一句话说明当前笔记标题，并提到 pa-p…',
            '移动端 smoke： 请用一句话说明当前笔记标题，并提到 pa-positive-snippet-token-1701。',
        )).toBe('');
        expect(getDistinctChatHistoryPreview(
            'Smoke test only. Reply exactly: PA_SMOKE_OK',
            'Smoke test only. Reply exactly: PA_SMOKE_OK',
        )).toBe('');
        expect(getDistinctChatHistoryPreview(
            'Memory setup',
            'Different note context was used.',
        )).toBe('Different note context was used.');
    });

    it('keeps message bubble enter animation opt-in and role icons transition fill and motion', () => {
        const css = readFileSync('src/custom.css', 'utf8');
        const messageBaseRule = css.match(/\.llm-message\s*{([\s\S]*?)\n}/);
        const identiconRule = css.match(/\.llm-view\s+\.pa-chat-role-identicon\s*{([\s\S]*?)\n}/)?.[1] ?? '';
        const identiconSvgRule = css.match(/\.llm-view\s+\.pa-chat-role-identicon-svg\s*{([\s\S]*?)\n}/)?.[1] ?? '';
        const identiconCellRule = css.match(/\.llm-view\s+\.pa-chat-role-identicon-cell\s*{([\s\S]*?)\n}/)?.[1] ?? '';
        const emptyScanRule = css.match(/\.llm-view\s+\.pa-chat-role-identicon-empty-scan\s*{([\s\S]*?)\n}/)?.[1] ?? '';

        expect(messageBaseRule?.[1]).not.toMatch(/\banimation\s*:/);
        expect(css).toMatch(/--pa-chat-role-identicon-yellow:\s*#f6c445;/);
        expect(css).toMatch(/@keyframes\s+pa-chat-role-identicon-empty-scan/);
        expect(css).toMatch(/@keyframes\s+pa-chat-role-identicon-filled-scan/);
        expect(identiconRule).toMatch(/transition:[\s\S]*background-color 220ms ease,[\s\S]*box-shadow 220ms ease,[\s\S]*opacity 180ms ease,[\s\S]*transform 240ms cubic-bezier/);
        expect(identiconSvgRule).toMatch(/fill:\s*none;/);
        expect(identiconSvgRule).toMatch(/shape-rendering:\s*crispEdges;/);
        expect(identiconSvgRule).toMatch(/transition:[\s\S]*opacity 200ms ease,[\s\S]*transform 240ms cubic-bezier/);
        expect(identiconCellRule).toMatch(/fill:\s*var\(--pa-chat-role-identicon-fill\);/);
        expect(identiconCellRule).not.toContain('transition:');
        expect(emptyScanRule).toMatch(/opacity:\s*0;/);
        expect(css).toMatch(/\.llm-message\.llm-message-enter\s*{[\s\S]*?animation:\s*message-fade-in 160ms ease-out;/);
        expect(identiconRule).toMatch(/overflow:\s*hidden;/);
        expect(css).toMatch(/\.llm-view\s+\.pa-chat-role-identicon-active\s+\.pa-chat-role-identicon-empty-scan\s*{[\s\S]*?animation:\s*pa-chat-role-identicon-empty-scan 1\.4s step-end infinite;/);
        expect(css).toMatch(/\.llm-view\s+\.pa-chat-role-identicon-active\s+\.pa-chat-role-identicon-filled-scan\s*{[\s\S]*?animation:\s*pa-chat-role-identicon-filled-scan 1\.4s step-end infinite;/);
        expect(css).toMatch(/\.llm-message\[aria-busy="true"\]\s+\.pa-chat-role-identicon-assistant\s*{[\s\S]*?opacity:\s*1;[\s\S]*?transform:\s*translateY\(-1px\);/);
        expect(css).toMatch(/@starting-style\s*{[\s\S]*?\.llm-message\.llm-message-enter\s+\.pa-chat-role-identicon\s*{[\s\S]*?opacity:\s*0\.72;[\s\S]*?transform:\s*translateY\(3px\);/);
        expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*?\.llm-message\.llm-message-enter\s*{[\s\S]*?animation:\s*none;/);
        expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*?\.llm-view\s+\.pa-chat-role-identicon,[\s\S]*?\.llm-view\s+\.pa-chat-role-identicon-svg\s*{[\s\S]*?transition:\s*none;/);
        expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*?\.llm-view\s+\.pa-chat-role-identicon-empty-scan,[\s\S]*?\.llm-view\s+\.pa-chat-role-identicon-filled-scan\s*{[\s\S]*?animation:\s*none;/);
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

    it('shows enabled skill typeahead candidates from the composer trigger', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();
        await flushPromises();

        getTextArea(containerEl).value = '#';

        const typeahead = getElementByClass(containerEl, 'pa-chat-skill-typeahead');
        expect(typeahead.hidden).toBe(false);
        expect(getElementsByClass(typeahead, 'pa-chat-skill-typeahead-item')).toHaveLength(7);
        expect(allText(typeahead)).toContain('Vault Link Health');
        expect(allText(typeahead)).toContain('#pa-vault-link-health');
    });

    it('filters skill typeahead candidates by per-skill settings and inserts the selected skill token', async () => {
        const { view, containerEl, plugin } = createView();
        plugin.settings.enabledSkillIds = ['pa-vault-link-health'];
        await view.onOpen();
        await flushPromises();

        const textArea = getTextArea(containerEl);
        textArea.value = 'Use #pa-';
        const typeahead = getElementByClass(containerEl, 'pa-chat-skill-typeahead');

        expect(getElementsByClass(typeahead, 'pa-chat-skill-typeahead-item')).toHaveLength(1);
        getElementsByClass(typeahead, 'pa-chat-skill-typeahead-item')[0].click();

        expect(textArea.value).toBe('Use #pa-vault-link-health ');
        expect(typeahead.hidden).toBe(true);
    });

    it('hides skill typeahead when skill guides are globally disabled', async () => {
        const { view, containerEl, plugin } = createView();
        plugin.settings.skillContextEnabled = false;
        await view.onOpen();
        await flushPromises();

        getTextArea(containerEl).value = '#';

        expect(getElementByClass(containerEl, 'pa-chat-skill-typeahead').hidden).toBe(true);
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
        jest.useFakeTimers();
        const { view, containerEl } = createView({ panelWidth: 430 });
        containerEl.boundingRect = { left: 0, top: 0, right: 430, bottom: 900, width: 430, height: 900 };
        const viewportState = { offsetTop: 0, height: 900 };
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

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('env(keyboard-inset-height, 0px)');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(false);
        expect(visualViewport.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(visualViewport.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));

        viewportState.height = 540;
        viewportListeners.get('resize')?.forEach((listener) => listener());
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('360px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-offset')).toBe('-360px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(true);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(false);

        viewportState.height = 900;
        viewportListeners.get('resize')?.forEach((listener) => listener());
        runAnimationFrames();

        // When JS clearance returns to 0, we hand off to CSS env(keyboard-inset-height)
        // so the browser/WebView bridges the gap before our observers fire on the next show.
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('env(keyboard-inset-height, 0px)');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-offset')).toBe('calc(0px - env(keyboard-inset-height, 0px))');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(false);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(false);
        expect(containerEl.style.getPropertyValue('--pa-chat-composer-height')).toBe('0px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');

        await view.onClose();

        expect(visualViewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(visualViewport.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    });

    it('uses native mobile keyboard events when the visual viewport does not report keyboard overlap', async () => {
        jest.useFakeTimers();
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
            listener({ detail: { keyboardHeight: 336 } } as Event & { detail: { keyboardHeight: number } });
        });
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('336px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-offset')).toBe('-336px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(true);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(true);

        windowListeners.get('keyboardWillHide')?.forEach((listener) => {
            listener({} as Event);
        });
        runAnimationFrames();

        // After hide, defer to CSS env(keyboard-inset-height) — the browser fills it back
        // in immediately on the next show, bridging the JS observer latency window.
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('env(keyboard-inset-height, 0px)');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-offset')).toBe('calc(0px - env(keyboard-inset-height, 0px))');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(false);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(false);

        await view.onClose();

        expect(windowWithKeyboardEvents.removeEventListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));
        expect(windowWithKeyboardEvents.removeEventListener).toHaveBeenCalledWith('keyboardWillHide', expect.any(Function));
    });

    it('keeps native fallback active when the visual viewport only matches native keyboard height', async () => {
        jest.useFakeTimers();
        const { view, containerEl } = createView({ panelWidth: 430 });
        containerEl.boundingRect = { left: 0, top: 0, right: 430, bottom: 900, width: 430, height: 900 };
        const viewportState = { offsetTop: 0, height: 900 };
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

        viewportState.height = 564;
        windowListeners.get('keyboardWillShow')?.forEach((listener) => {
            listener({ detail: { keyboardHeight: 336 } } as Event & { detail: { keyboardHeight: number } });
        });
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('336px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(true);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(true);

        viewportState.height = 600;
        viewportListeners.get('resize')?.forEach((listener) => listener());
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('336px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(true);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(true);

        viewportState.height = 508;
        viewportListeners.get('resize')?.forEach((listener) => listener());
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('392px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(true);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(false);

        await view.onClose();
    });

    it('keeps native clearance until the chat view has resized above the keyboard', async () => {
        jest.useFakeTimers();
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

        windowListeners.get('keyboardWillShow')?.forEach((listener) => {
            listener({ keyboardHeight: 336 } as Event & { keyboardHeight: number });
        });
        runAnimationFrames();
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('336px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(true);

        windowWithKeyboardEvents.innerHeight = 560;
        windowListeners.get('resize')?.forEach((listener) => listener({} as Event));
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('340px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-offset')).toBe('-340px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(true);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(true);

        containerEl.boundingRect = { left: 0, top: 0, right: 430, bottom: 560, width: 430, height: 560 };
        windowListeners.get('resize')?.forEach((listener) => listener({} as Event));
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('0px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-offset')).toBe('0px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(true);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(false);

        windowListeners.get('keyboardWillHide')?.forEach((listener) => {
            listener({} as Event);
        });
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('env(keyboard-inset-height, 0px)');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-offset')).toBe('calc(0px - env(keyboard-inset-height, 0px))');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(false);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(false);
        expect(containerEl.style.getPropertyValue('--pa-chat-composer-height')).toBe('0px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');

        await view.onClose();
    });

    it('hands keyboard layout to Capacitor via setResizeMode body mode when the plugin is available', async () => {
        const { view } = createView({ panelWidth: 430 });
        const setResizeMode = jest.fn<(options: { mode: string }) => Promise<void>>(() => Promise.resolve());
        const addListener = jest.fn<(eventName: string, listener: (info: unknown) => void) => Promise<{ remove: () => Promise<void> }>>(
            () => Promise.resolve({ remove: () => Promise.resolve() }),
        );
        (globalThis.window as typeof globalThis.window & {
            Capacitor?: { Plugins?: { Keyboard?: unknown } };
        }).Capacitor = {
            Plugins: {
                Keyboard: { addListener, setResizeMode },
            },
        };

        await view.onOpen();

        expect(setResizeMode).toHaveBeenCalledWith({ mode: 'body' });
        expect(addListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function));
        expect(addListener).toHaveBeenCalledWith('keyboardWillHide', expect.any(Function));

        await view.onClose();

        delete (globalThis.window as typeof globalThis.window & { Capacitor?: unknown }).Capacitor;
    });

    it('resets nativeKeyboardHeight on hide so the next show event installs a fresh value', async () => {
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

        // Show 1: tall keyboard
        windowListeners.get('keyboardWillShow')?.forEach((listener) => {
            listener({ keyboardHeight: 400 } as Event & { keyboardHeight: number });
        });
        runAnimationFrames();
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('400px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');

        // Hide
        windowListeners.get('keyboardWillHide')?.forEach((listener) => listener({} as Event));
        runAnimationFrames();
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('env(keyboard-inset-height, 0px)');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');

        // Show 2: short keyboard — must reflect new value, not the previous 400
        windowListeners.get('keyboardWillShow')?.forEach((listener) => {
            listener({ keyboardHeight: 250 } as Event & { keyboardHeight: number });
        });
        runAnimationFrames();
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('250px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-offset')).toBe('-250px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');

        await view.onClose();
    });

    it('primes textarea focus from touch input without stealing button clicks', async () => {
        const { view, containerEl } = createView();
        const documentWithFocus = { activeElement: null as MockElement | null };
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: documentWithFocus,
        });
        await view.onOpen();

        const composerRow = getElementByClass(containerEl, 'pa-chat-composer-row');
        const textArea = getTextArea(containerEl);
        const memoryChip = getButtonByClass(containerEl, 'pa-chat-memory-chip');
        const moreButton = getButtonByClass(containerEl, 'pa-chat-more-button');

        composerRow.dispatchEvent('pointerdown', {
            target: memoryChip,
            defaultPrevented: false,
        });

        expect(documentWithFocus.activeElement).toBeNull();

        composerRow.dispatchEvent('click', {
            target: moreButton,
            defaultPrevented: false,
        });

        expect(documentWithFocus.activeElement).toBeNull();

        composerRow.dispatchEvent('pointerdown', {
            target: textArea,
            defaultPrevented: false,
        });

        expect(documentWithFocus.activeElement).toBe(textArea);

        documentWithFocus.activeElement = null;
        composerRow.dispatchEvent('touchstart', {
            target: textArea,
            defaultPrevented: false,
        });

        expect(documentWithFocus.activeElement).toBe(textArea);

        documentWithFocus.activeElement = null;
        composerRow.dispatchEvent('click', {
            target: composerRow,
            defaultPrevented: false,
        });

        expect(documentWithFocus.activeElement).toBe(textArea);
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
        streamCalls[0].onChunk('answer without citation block');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const text = allText(containerEl);
        expect(text).toContain('Context Used');
        expect(text).toContain('Selected Memory');
        expect(text).toContain('Current note');
        expect(text).toContain('Dog');
        expect(text).toContain('current');
        expect(text).toContain('Eligible for Memory references');
        expect(text).toContain('Not a Memory reference');
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
        runAnimationFrames();
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
        const callout = getElementByClass(containerEl, 'callout');
        expect(callout.getAttribute('data-callout')).toBe('personal-assistant-ai');
        expect(getElementByClass(callout, 'internal-link').getAttribute('data-href')).toBe('memory/late.md');
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

        expect(allText(containerEl)).toContain('No related memory');
        expect(allText(containerEl)).toContain('Checking 2 related notes...');
        expect(allText(containerEl)).toContain('Reading selected Memory...');
        expect(allText(containerEl)).toContain('Vault context unavailable');
        expect(allText(containerEl)).toContain('Reading note outline...');
        expect(allText(containerEl)).toContain('Context Used');
        expect(allText(containerEl)).not.toContain('fallback path');
        expect(allText(containerEl)).not.toContain('memory references');
        expect(allText(containerEl)).not.toContain('candidate');
        expect(allText(containerEl)).not.toContain('indexed fallback');
        expect(allText(containerEl)).not.toContain('Fallback');
        expect(allText(containerEl)).not.toContain('Read-only tool');
        expect(allText(containerEl)).not.toContain('0.unsorted/Dog.md');
    });

    it('uses product language for Obsidian Operations read-only tool statuses', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'operations status prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({
            type: 'tool-running',
            tool: 'inspect_obsidian_note',
            message: 'Reading note structure for notes/current.md',
        });
        streamCalls[0].options.onStatus?.({
            type: 'tool-running',
            tool: 'read_canvas_summary',
            message: 'Checking canvas structure for maps/project.canvas',
        });
        streamCalls[0].options.onStatus?.({
            type: 'tool-running',
            tool: 'search_vault_snippets',
            message: 'Searching note snippets for roadmap',
        });
        streamCalls[0].options.onStatus?.({
            type: 'tool-running',
            tool: 'list_vault_tags',
            message: 'Reading vault tags',
        });

        const runningText = allText(containerEl);
        expect(runningText).toContain('Reading note structure...');
        expect(runningText).toContain('Checking canvas structure...');
        expect(runningText).toContain('Searching note snippets...');
        expect(runningText).toContain('Reading vault tags...');

        streamCalls[0].options.onStatus?.({
            type: 'tool-done',
            tool: 'inspect_obsidian_note',
            message: 'Read note structure: 1 heading(s), 0 task(s), 0 tag(s).',
            sources: [{ path: 'notes/current.md' }],
        });
        streamCalls[0].options.onStatus?.({
            type: 'tool-done',
            tool: 'read_canvas_summary',
            message: 'Read canvas structure: 2 node(s), 1 edge(s).',
            sources: [{ path: 'maps/project.canvas' }],
        });
        streamCalls[0].options.onStatus?.({
            type: 'tool-done',
            tool: 'search_vault_snippets',
            message: 'Found 1 bounded snippet match(es).',
            sources: [{ path: 'notes/roadmap.md' }],
        });
        streamCalls[0].options.onStatus?.({
            type: 'tool-done',
            tool: 'list_vault_tags',
            message: 'Listed 2 vault tag(s).',
            sources: [],
        });

        const text = allText(containerEl);
        expect(text).toContain('Context Used');
        expect(text).toContain('Note structure');
        expect(text).toContain('links/backlinks');
        expect(text).toContain('Canvas structure');
        expect(text).toContain('Note snippets');
        expect(text).toContain('Vault tags');
        expect(text).toContain('Not a Memory reference');
        expect(text).not.toContain('inspect_obsidian_note');
        expect(text).not.toContain('read_canvas_summary');
        expect(text).not.toContain('search_vault_snippets');
        expect(text).not.toContain('list_vault_tags');
        expect(text).not.toContain('VSS');
        expect(text).not.toContain('RAG');
    });

    it('shows unavailable Obsidian Operations tool results as status-only context', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'operations unavailable prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({
            type: 'tool-done',
            tool: 'list_vault_tags',
            message: 'Vault tags unavailable.',
            sources: [],
            availability: 'unavailable',
        });

        const text = allText(containerEl);
        expect(text).toContain('Vault tags unavailable.');
        expect(text).toContain('Context Used');
        expect(text).toContain('Vault tags unavailable');
        expect(text).toContain('Vault context was unavailable for this turn.');
        expect(text).toContain('Status only');
        expect(text).not.toContain('list_vault_tags');
    });

    it('does not mark duplicate read-only tool calls as unavailable context', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'duplicate read-only tool prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onStatus?.({
            type: 'tool-done',
            tool: 'inspect_obsidian_note',
            message: 'Read note structure: 2 heading(s), 2 task(s), 2 tag(s).',
            sources: [{ path: 'obsidian-operations/note-structure-smoke.md' }],
            availability: 'available',
        });
        streamCalls[0].options.onStatus?.({
            type: 'tool-skipped',
            tool: 'inspect_obsidian_note',
            reason: 'Duplicate read-only tool call skipped.',
        });
        streamCalls[0].options.onStatus?.({
            type: 'fallback',
            reason: 'Native tool planning stopped before a final planner action.',
        });

        const text = allText(containerEl);
        expect(text).toContain('Read note structure: 2 heading(s), 2 task(s), 2 tag(s).');
        expect(text).toContain('Vault context already gathered');
        expect(text).toContain('Using gathered context after reaching the planning limit.');
        expect(text).toContain('Context Used');
        expect(text).toContain('Note structure');
        expect(text).not.toContain('Note structure unavailable');
        expect(text).not.toContain('Vault context was unavailable for this turn.');
        expect(text).not.toContain('Vault context unavailable');
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

describe('mobile tab bar auto-hide', () => {
    let originalPlatform: { isDesktop: boolean; isMobile: boolean };

    function buildMobileDrawerDOM() {
        const drawerInner = new MockElement('div');
        drawerInner.classList.add('workspace-drawer-inner');
        const tabContainer = new MockElement('div');
        tabContainer.classList.add('workspace-drawer-tab-container');
        drawerInner.appendChild(tabContainer);
        const tabOptions = new MockElement('div');
        tabOptions.classList.add('workspace-drawer-tab-options');
        tabContainer.appendChild(tabOptions);
        const activeTabContent = new MockElement('div');
        activeTabContent.classList.add('workspace-drawer-active-tab-content');
        tabContainer.appendChild(activeTabContent);
        const workspaceLeaf = new MockElement('div');
        workspaceLeaf.classList.add('workspace-leaf');
        activeTabContent.appendChild(workspaceLeaf);
        return { drawerInner, tabContainer, tabOptions, workspaceLeaf };
    }

    function createMobileView() {
        const { drawerInner, tabContainer, tabOptions, workspaceLeaf } = buildMobileDrawerDOM();
        const { view, containerEl, ...rest } = createView();
        workspaceLeaf.appendChild(containerEl);
        return { view, containerEl, drawerInner, tabContainer, tabOptions, ...rest };
    }

    beforeEach(() => {
        const { Platform } = jest.requireMock('obsidian') as { Platform: { isDesktop: boolean; isMobile: boolean } };
        originalPlatform = { ...Platform };
        Platform.isMobile = true;
        Platform.isDesktop = false;

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                requestAnimationFrame: jest.fn((cb: FrameRequestCallback) => { cb(0); return 0; }),
                cancelAnimationFrame: jest.fn(),
            },
        });
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createElement: (tag: string) => new MockElement(tag),
            },
        });
        Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: undefined });
        Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: undefined });
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { clipboard: { writeText: jest.fn(async () => undefined) } },
        });
    });

    afterEach(() => {
        const { Platform } = jest.requireMock('obsidian') as { Platform: { isDesktop: boolean; isMobile: boolean } };
        Platform.isMobile = originalPlatform.isMobile;
        Platform.isDesktop = originalPlatform.isDesktop;
        jest.useRealTimers();
    });

    it('creates a handle and removes the click listener from tabOptions on teardown', async () => {
        const { view, containerEl, tabOptions } = createMobileView();
        await view.onOpen();

        const handle = walk(containerEl, (el) => el.classList.contains('pa-tab-bar-handle'));
        expect(handle).not.toBeNull();
        const keyboardSpacer = walk(containerEl, (el) => el.classList.contains('pa-chat-keyboard-spacer'));
        expect(keyboardSpacer).not.toBeNull();
        expect(keyboardSpacer!.getAttribute('aria-hidden')).toBe('true');
        expect(containerEl.children).toHaveLength(4);
        expect(containerEl.children[0].classList.contains('llm-chat-container')).toBe(true);
        expect(containerEl.children[1].classList.contains('llm-input')).toBe(true);
        expect(containerEl.children[2]).toBe(handle);
        expect(containerEl.children[3]).toBe(keyboardSpacer);

        const listenersBefore = tabOptions.listeners.get('click')?.length ?? 0;
        expect(listenersBefore).toBeGreaterThan(0);

        await view.onClose();

        const listenersAfter = tabOptions.listeners.get('click')?.length ?? 0;
        expect(listenersAfter).toBe(listenersBefore - 1);
        expect(handle!.parentElement).toBeNull();
    });

    it('keeps the mobile shell ordered while the native keyboard spacer is active', async () => {
        const windowListeners = new Map<string, Array<EventListener>>();
        let nextFrameId = 1;
        let frames: AnimationFrameCall[] = [];
        const runLocalAnimationFrames = () => {
            const pending = [...frames];
            frames = [];
            for (const frame of pending) {
                if (!frame.cancelled) frame.callback(frame.id);
            }
        };
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                innerHeight: 900,
                innerWidth: 430,
                requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
                    const id = nextFrameId;
                    nextFrameId += 1;
                    frames.push({ id, callback, cancelled: false });
                    return id;
                }),
                cancelAnimationFrame: jest.fn((id: number) => {
                    const frame = frames.find((candidate) => candidate.id === id);
                    if (frame) frame.cancelled = true;
                }),
                addEventListener: jest.fn((type: string, listener: EventListener) => {
                    const listeners = windowListeners.get(type) ?? [];
                    listeners.push(listener);
                    windowListeners.set(type, listeners);
                }),
                removeEventListener: jest.fn(),
            },
        });
        const { view, containerEl } = createMobileView();
        containerEl.boundingRect = { left: 0, top: 0, right: 430, bottom: 900, width: 430, height: 900 };

        await view.onOpen();
        windowListeners.get('keyboardWillShow')?.forEach((listener) => {
            listener({ detail: { keyboardHeight: 336 } } as Event & { detail: { keyboardHeight: number } });
        });
        runLocalAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-clearance')).toBe('336px');
        expect(containerEl.style.getPropertyValue('--pa-chat-keyboard-accessory-clearance')).toBe('0px');
        expect(containerEl.classList.contains('is-keyboard-open')).toBe(true);
        expect(containerEl.classList.contains('is-keyboard-native-fallback')).toBe(true);
        expect(containerEl.children).toHaveLength(4);
        expect(containerEl.children[0].classList.contains('llm-chat-container')).toBe(true);
        expect(containerEl.children[1].classList.contains('llm-input')).toBe(true);
        expect(containerEl.children[2].classList.contains('pa-tab-bar-handle')).toBe(true);
        expect(containerEl.children[3].classList.contains('pa-chat-keyboard-spacer')).toBe(true);

        await view.onClose();
    });

    it('toggles aria-label and aria-expanded on handle click', async () => {
        jest.useFakeTimers();
        const { view, containerEl, tabOptions } = createMobileView();
        await view.onOpen();

        const handle = walk(containerEl, (el) => el.classList.contains('pa-tab-bar-handle'))!;
        expect(handle.getAttribute('aria-expanded')).toBe('false');
        expect(handle.getAttribute('aria-label')).toBe('Show tab bar');

        handle.click();
        expect(handle.getAttribute('aria-expanded')).toBe('true');
        expect(handle.getAttribute('aria-label')).toBe('Hide tab bar');
        expect(tabOptions.classList.contains('pa-tab-bar-visible')).toBe(true);

        handle.click();
        expect(handle.getAttribute('aria-expanded')).toBe('false');
        expect(handle.getAttribute('aria-label')).toBe('Show tab bar');
        expect(tabOptions.classList.contains('pa-tab-bar-visible')).toBe(false);
    });

    it('does not create duplicate handles on re-entry without onClose', async () => {
        const { view, containerEl, tabOptions } = createMobileView();
        await view.onOpen();
        await view.onOpen();

        const handles = walkAll(containerEl, (el) => el.classList.contains('pa-tab-bar-handle'));
        expect(handles).toHaveLength(1);

        const clickListeners = tabOptions.listeners.get('click')?.length ?? 0;
        expect(clickListeners).toBe(1);
    });

    it('auto-dismisses the tab bar after 5 seconds', async () => {
        jest.useFakeTimers();
        const { view, containerEl, tabOptions } = createMobileView();
        await view.onOpen();

        const handle = walk(containerEl, (el) => el.classList.contains('pa-tab-bar-handle'))!;
        handle.click();
        expect(tabOptions.classList.contains('pa-tab-bar-visible')).toBe(true);

        jest.advanceTimersByTime(4999);
        expect(tabOptions.classList.contains('pa-tab-bar-visible')).toBe(true);

        jest.advanceTimersByTime(1);
        expect(tabOptions.classList.contains('pa-tab-bar-visible')).toBe(false);
        expect(handle.getAttribute('aria-expanded')).toBe('false');
    });
});
