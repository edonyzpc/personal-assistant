import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { Component, MarkdownRenderer, MarkdownView, Modal, Notice, Platform, TFile, type App } from 'obsidian';
import type { ChatAgentStatus, ChatMessage, StreamLLMOptions } from '../src/ai-services/chat-service';
import type { AgentEvent, PaAgentMessage } from '../src/ai-services/chat-types';
import { CHAT_MENU_IDLE_CLOSE_MS, formatOperationsPreview, LLMView, PA_CHAT_SUBAGENT_ICON } from '../src/chat/chat-view';
import { mergeContextUsedItems, normalizeContextUsedItems } from '../src/chat/formatters';
import { ChatConfirmationModal, getDistinctChatHistoryPreview } from '../src/chat/modals';
import { getChatRoleIdenticonModel } from '../src/chat/role-identicons';
import { ChatHistoryManager } from '../src/chat/chat-history-manager';
import { MemoryChatHistoryStore } from '../src/chat/chat-history-store';
import { WritingVersionService } from '../src/chat/writing-versions';
import { WritingRecoveryModal, WritingSaveModal, WritingStyleModal, WritingVersionModal } from '../src/chat/writing-modal';
import { WritingStyleUnavailableError } from '../src/chat/writing-style-service';
import type { WritingVersion } from '../src/chat/writing-types';
import type { WritingSaveAction, PreparedWritingSave } from '../src/chat/writing-save-action';
import { ImageManagementModal, ImageSourcePickerModal, VaultImagePickerModal } from '../src/chat/image-management-modal';
import { ImageAttachmentDetailModal } from '../src/chat/image-attachment-view';
import { ImageAssetService } from '../src/chat/image-assets';
import { PaAgentContextOverflowError } from '../src/ai-services/context';
import type { MemoryMaintenancePlan } from '../src/memory-manager';
import type { PageletChatHandoffContext } from '../src/ai-services/pagelet-handoff';
import type { ComposerDraft } from '../src/chat/composer-draft';
import type { MessageImage } from '../src/chat/image-types';
import type {
    OperationsExecutionResult,
    OperationsIntent,
    PreparedOperation,
    UndoResult,
} from '../src/ai-services/operations/types';

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
const mockConfirmOperationsIntent = jest.fn<(intentId: string) => Promise<OperationsExecutionResult>>();
const mockCancelOperationsIntent = jest.fn<(intentId: string) => OperationsIntent>();
const mockCancelPendingOperations = jest.fn<() => void>();
const mockUndoOperations = jest.fn<(receiptIds: readonly string[]) => Promise<UndoResult[]>>();
const mockDisposeChatService = jest.fn<() => void>();
const mockResetChatContext = jest.fn<() => void>();
jest.mock('../src/ai-services/chat-service', () => ({
    ChatService: jest.fn().mockImplementation(() => ({
        streamLLM: mockStreamLLM,
        confirmOperationsIntent: mockConfirmOperationsIntent,
        cancelOperationsIntent: mockCancelOperationsIntent,
        cancelPendingOperations: mockCancelPendingOperations,
        undoOperations: mockUndoOperations,
        dispose: mockDisposeChatService,
        resetContext: mockResetChatContext,
    })),
}));

jest.mock('../src/share-card/share-card-modal', () => {
    const mockOpen = jest.fn();
    return {
        ShareCardModal: jest.fn((_app: unknown, _data: unknown) => ({ open: mockOpen })),
        mockOpen,
    };
});

const shareCardModalMock = jest.requireMock('../src/share-card/share-card-modal') as {
    ShareCardModal: jest.Mock;
    mockOpen: jest.Mock;
};
const mockShareCardModalConstructor = shareCardModalMock.ShareCardModal;
const mockShareCardModalOpen = shareCardModalMock.mockOpen;

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
    readonly dataset: Record<string, string> = {};
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
    scrollLeft = 0;
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

    addClass(...classes: string[]) {
        this.classList.add(...classes);
    }

    removeClass(...classes: string[]) {
        this.classList.remove(...classes);
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

    click(detail = 0) {
        if (this.disabled) return undefined;
        const event = {
            target: this,
            currentTarget: this,
            detail,
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

    setAttr(name: string, value: string) {
        this.setAttribute(name, value);
    }

    setCssProps(props: Record<string, string>) {
        for (const [name, value] of Object.entries(props)) {
            if (value === '') {
                this.style.removeProperty(name);
            } else {
                this.style.setProperty(name, value);
            }
        }
    }

    setCssStyles(styles: Partial<CSSStyleDeclaration>) {
        for (const [name, value] of Object.entries(styles)) {
            if (typeof value === 'string') {
                this.style.setProperty(name, value);
            }
        }
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

    findAll(selector: string) {
        return this.querySelectorAll(selector);
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

function getRoleIdenticonShapeSignature(root: MockElement, className: string): string {
    const identicon = getElementByClass(root, className);
    return getElementsByClass(identicon, 'pa-chat-role-identicon-filled-cell')
        .map((cell) => `${cell.getAttribute('x')}:${cell.getAttribute('y')}`)
        .sort()
        .join('|');
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

function createPageletHandoffContext(body = `# Verified insight\n\n${"Complete evidence. ".repeat(40)}`): PageletChatHandoffContext {
    return {
        version: 1,
        id: 'pagelet-cache-1',
        body,
        anchor: {
            path: 'projects/anchor.md',
            mtime: 10,
            size: 100,
            contentHash: 'anchor-hash',
        },
        sources: [
            { path: 'research/a.md', mtime: 11, size: 101, contentHash: 'a-hash' },
            { path: 'research/b.md', mtime: 12, size: 102, contentHash: 'b-hash' },
        ],
        sourceRefs: [
            { path: 'research/a.md', title: 'Source A' },
            { path: 'research/b.md', title: 'Source B' },
        ],
        webUrls: ['https://example.com/a', 'https://example.com/b'],
        whyNow: ['The anchor changed.', 'The sources now agree.'],
        triggerReason: 'explicit',
        preparedAt: 1_700_000_000_000,
        pipelineVersion: 'pagelet-deep-discover-v1',
    };
}

function createWritableChatHistoryManager(options: {
    recordTurnError?: Error;
    clearPointerError?: Error;
} = {}) {
    let activeConversationId: string | null = null;
    const createdConversation = {
        id: 'conv_pagelet_handoff',
        title: 'Current conversation',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        turnCount: 0,
        preview: 'Current prompt',
    };
    return {
        initialize: jest.fn(async () => undefined),
        isAvailable: jest.fn(() => true),
        getActiveConversationId: jest.fn(async () => activeConversationId),
        startConversation: jest.fn(async () => {
            activeConversationId = createdConversation.id;
            return createdConversation;
        }),
        recordTurn: jest.fn(async () => {
            if (options.recordTurnError) throw options.recordTurnError;
            return { ...createdConversation, turnCount: 1 };
        }),
        maybePrune: jest.fn(async () => []),
        setActiveConversationId: jest.fn(async (id: string | null) => {
            if (id === null && options.clearPointerError) throw options.clearPointerError;
            activeConversationId = id;
        }),
    };
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
    (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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

const createdViews = new Set<LLMView>();

afterEach(async () => {
    const views = Array.from(createdViews);
    createdViews.clear();
    await Promise.all(views.map(async (view) => {
        await view.onClose();
    }));
});

function createView(options: {
    withMarkdownLeaf?: boolean;
    panelWidth?: number;
    chatHistoryManager?: unknown;
    setupIssue?: string | null;
    inlineSetup?: boolean;
    tokenState?: 'unknown' | 'present' | 'missing';
    setupResult?: { ok: true } | { ok: false; code: 'invalid_configuration' | 'token_required' | 'token_save_failed' | 'settings_save_failed' | 'compensation_failed' };
    operationsEnabled?: boolean;
} = {}) {
    const containerEl = new MockElement('div');
    containerEl.clientWidth = options.panelWidth ?? 600;
    const workspaceHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
    const memoryStatusListeners = new Set<() => void | Promise<void>>();
    const settingsChangeListeners = new Set<() => void | Promise<void>>();
    let setupIssue = options.setupIssue ?? null;
    let tokenState = options.tokenState ?? 'missing';
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
        isOperationsAgentEnabled: options.operationsEnabled === true,
        settings: {
            debug: false,
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
            aiProvider: 'openai',
            baseURL: '',
            chatModelName: 'gpt-test',
            embeddingModelName: 'embed-test',
            operationsAgentEnabled: options.operationsEnabled === true,
            operationsProactiveSaveSuggestionsEnabled: true,
        },
        chatHistoryManager: options.chatHistoryManager,
        memoryStatus: {
            getMaintenancePlan: jest.fn(async (): Promise<MemoryMaintenancePlan> => ({
                reason: 'ready',
                action: 'none',
                notesToCheck: 0,
                requiresApproval: false,
                canAnswerNow: true,
            })),
            prepareFromCommand: jest.fn(async () => undefined),
            updateFromCommand: jest.fn(async () => undefined),
            showTechnicalStatus: jest.fn(() => undefined),
            onStatusChanged: jest.fn((listener: () => void | Promise<void>) => {
                memoryStatusListeners.add(listener);
                return () => {
                    memoryStatusListeners.delete(listener);
                };
            }),
        },
        getAISetupIssue: jest.fn(() => setupIssue),
        ...(options.inlineSetup ? {
            getAIReadiness: jest.fn(() => {
                const issue = setupIssue === null
                    ? null
                    : setupIssue.includes('token')
                        ? tokenState === 'present'
                            ? null
                            : tokenState === 'unknown'
                                ? 'token_unknown' as const
                                : 'token_missing' as const
                        : 'base_url_missing' as const;
                return {
                    scope: 'chat' as const,
                    ready: issue === null,
                    issue,
                    tokenState,
                    hasToken: tokenState === 'present',
                    aiProvider: 'openai',
                    baseURL: '',
                    chatModelName: 'gpt-test',
                    embeddingModelName: 'embed-test',
                };
            }),
            refreshAPITokenPresence: jest.fn(() => {
                if (tokenState === 'present' && setupIssue?.includes('token')) {
                    setupIssue = null;
                }
                return tokenState;
            }),
            completeAISetup: jest.fn(async () => {
                const result = options.setupResult ?? { ok: true as const };
                if (result.ok) setupIssue = null;
                return result;
            }),
        } : {}),
        onSettingsChanged: jest.fn((listener: () => void | Promise<void>) => {
            settingsChangeListeners.add(listener);
            return () => {
                settingsChangeListeners.delete(listener);
            };
        }),
        createChatService: jest.fn(() => ({
            streamLLM: mockStreamLLM,
            confirmOperationsIntent: mockConfirmOperationsIntent,
            cancelOperationsIntent: mockCancelOperationsIntent,
            cancelPendingOperations: mockCancelPendingOperations,
            undoOperations: mockUndoOperations,
            dispose: mockDisposeChatService,
            resetContext: mockResetChatContext,
        })),
        openMemorySettings: jest.fn(),
        log: jest.fn(),
    };
    const leaf = { app, containerEl };
    const view = new LLMView(
        leaf as unknown as ConstructorParameters<typeof LLMView>[0],
        plugin as unknown as ConstructorParameters<typeof LLMView>[1],
    );
    createdViews.add(view);
    const emitWorkspaceEvent = (eventName: string, ...args: unknown[]) => {
        for (const handler of workspaceHandlers.get(eventName) ?? []) {
            handler(...args);
        }
    };
    const emitMemoryStatusChanged = async () => {
        await Promise.all(Array.from(memoryStatusListeners, (listener) => listener()));
    };
    const emitSettingsChanged = async () => {
        await Promise.all(Array.from(settingsChangeListeners, (listener) => listener()));
    };
    const getMemoryStatusListenerCount = () => memoryStatusListeners.size;
    const getSettingsChangeListenerCount = () => settingsChangeListeners.size;
    const setAISetupIssue = (value: string | null) => {
        setupIssue = value;
    };
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
        emitSettingsChanged,
        getMemoryStatusListenerCount,
        getSettingsChangeListenerCount,
        setAISetupIssue,
        setTokenState: (value: 'unknown' | 'present' | 'missing') => { tokenState = value; },
    };
}

describe('Context Used formatter governed Memory identity', () => {
    it('preserves exact claim ids through normalization and keeps distinct claims separate when merging', () => {
        const normalized = normalizeContextUsedItems([{
            category: 'memory',
            label: 'Saved understanding',
            statusOnly: true,
            memoryClaimId: 'claim-exact-1',
            memoryEffect: 'future_answers',
            memorySource: 'notes',
            memoryScope: 'current_vault',
            sources: [{ path: 'private/governed-source.md' }],
        }]);

        expect(normalized).toEqual([expect.objectContaining({
            memoryClaimId: 'claim-exact-1',
            memoryEffect: 'future_answers',
            memorySource: 'notes',
            memoryScope: 'current_vault',
            sources: undefined,
        })]);

        const merged = mergeContextUsedItems(normalized, [{
            category: 'memory',
            label: 'Saved understanding',
            statusOnly: true,
            memoryClaimId: 'claim-exact-2',
            memoryEffect: 'collaboration_default',
        }]);

        expect(merged.map((item) => item.memoryClaimId)).toEqual([
            'claim-exact-1',
            'claim-exact-2',
        ]);
    });
});

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
        mockConfirmOperationsIntent.mockReset();
        mockCancelOperationsIntent.mockReset();
        mockCancelPendingOperations.mockReset();
        mockUndoOperations.mockReset();
        mockDisposeChatService.mockReset();
        mockResetChatContext.mockReset();
        mockShareCardModalConstructor.mockClear();
        mockShareCardModalOpen.mockClear();
        mockUndoOperations.mockResolvedValue([]);
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockClear();
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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

    it('uses the custom subagent icon for the chat view', () => {
        const { view } = createView();

        expect(view.getIcon()).toBe(PA_CHAT_SUBAGENT_ICON);
    });

    it('freezes a host-bound writing artifact once and keeps the raw envelope out of the visible/copy answer', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'writing-conversation' });
        const versions = new WritingVersionService(store);
        const { view, plugin, containerEl } = createView({ chatHistoryManager: manager });
        Object.assign(plugin, { writingVersions: versions });
        await view.onOpen();
        view.prefillComposer('帮我写一段旅行文案');
        getElementByClass(containerEl, 'send-button-visible').click();
        await flushPromises();
        const call = streamCalls[0];
        expect(call.options.writingRequest?.requestId).toBeTruthy();
        const raw = '{"body":"不直接展示整个 envelope"}';
        emitCanonical(call, canonicalEvent({ type: 'agent_start' }));
        emitCanonical(call, canonicalEvent({ type: 'turn_start' }));
        emitCanonical(call, canonicalEvent({ type: 'message_end', message: assistantMessage('writing_answer', [{ type: 'text', text: raw }]) }));
        expect(allText(containerEl)).not.toContain(raw);
        const artifact = { version: 1 as const, turnId: 'turn_1', seq: 10, timestamp: 1,
            kind: 'writing-artifact' as const, runId: 'run_1', requestId: call.options.writingRequest!.requestId,
            messageId: 'writing_answer', body: '  海边的风。\n带着盐味。🙂', explanation: '辅助说明单独保留' };
        call.options.onEvent?.(artifact);
        call.options.onEvent?.(artifact);
        call.resolve();
        for (let i = 0; i < 8; i++) await flushPromises();
        const stored = await versions.list('writing-conversation');
        expect(stored).toHaveLength(1);
        expect(stored[0].text).toBe(artifact.body);
        expect(stored[0].explanation).toBe(artifact.explanation);
        expect(view.chatHistory[1].content).toBe(artifact.body);
        expect(view.chatHistory[1].writingVersionId).toBe(stored[0].id);
        expect((await store.getTurns('writing-conversation'))[0].assistant.writingVersionId).toBe(stored[0].id);
        expect(getElementsByClass(containerEl, 'pa-chat-writing-action')).toHaveLength(1);
        expect(allText(containerEl)).not.toContain(raw);
    });

    it('retains incomplete writing separately and does not infer an artifact from valid-looking JSON', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'recovery-conversation' });
        const versions = new WritingVersionService(store);
        const { view, plugin, containerEl } = createView({ chatHistoryManager: manager });
        Object.assign(plugin, { writingVersions: versions });
        await view.onOpen();
        view.prefillComposer('重写文案');
        getElementByClass(containerEl, 'send-button-visible').click();
        await flushPromises();
        const call = streamCalls[0];
        const rawText = '{"kind":"pa.writing","body":"被截断的输出也不自动采纳"}';
        call.options.onEvent?.({ version: 1, turnId: 'turn_1', seq: 10, timestamp: 1,
            kind: 'writing-recovery', runId: 'run_1', requestId: call.options.writingRequest!.requestId,
            messageId: 'incomplete_answer', rawText, reason: 'provider_incomplete' });
        call.resolve();
        for (let i = 0; i < 6; i++) await flushPromises();
        expect(await versions.list('recovery-conversation')).toEqual([]);
        expect(view.chatHistory[1].writingRecovery?.rawText).toBe(rawText);
        expect(view.chatHistory[1].content).not.toContain(rawText);
        expect((await store.getTurns('recovery-conversation'))[0].assistant.writingRecovery?.rawText).toBe(rawText);
        expect(allText(containerEl)).not.toContain(rawText);
        expect(getElementsByClass(containerEl, 'pa-chat-writing-action')).toHaveLength(1);
    });

    it.each(['artifact', 'recovery'] as const)('persists host resolved materials for writing %s with no composer images', async (kind) => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'resolved-writing' });
        const versions = new WritingVersionService(store);
        const { view, plugin, containerEl } = createView({ chatHistoryManager: manager });
        Object.assign(plugin, { writingVersions: versions });
        await view.onOpen();
        view.prefillComposer('继续刚才的文案任务：请重新查看第3张图片');
        getElementByClass(containerEl, 'send-button-visible').click();
        await flushPromises();
        const call = streamCalls[0];
        const material: MessageImage = { ordinal: 3, label: 'source.png', ref: { assetId: 'png', contentHash: 'a'.repeat(64) } };
        await store.putImageAsset({ id: material.ref.assetId, originalHash: material.ref.contentHash, source: 'vault_reference',
            originalPath: 'source.png', detectedMime: 'image/png', byteLength: 3, acquisition: 'original_file',
            anchorPath: 'PA Chat.md', anchorKind: 'logical_root', state: 'available', createdAt: 1, owners: [] });
        const shared = { version: 1 as const, turnId: 'turn_1', seq: 10, timestamp: 1, runId: 'run_1',
            requestId: call.options.writingRequest!.requestId, messageId: 'writing_answer', associatedImages: [material] };
        call.options.onEvent?.(kind === 'artifact' ? { ...shared, kind: 'writing-artifact', body: 'BODY', explanation: '' }
            : { ...shared, kind: 'writing-recovery', rawText: 'prefix BODY suffix', reason: 'invalid_output' });
        call.resolve();
        for (let i = 0; i < 8; i++) await flushPromises();
        const turns = await store.getTurns('resolved-writing');
        expect(turns[0].assistant.images).toEqual([material]);
        if (kind === 'artifact') expect((await versions.list('resolved-writing'))[0].associatedImages.map((image) => image.ref)).toEqual([material.ref]);
        else {
            expect(await versions.list('resolved-writing')).toEqual([]);
            await view.onClose();
            const restored = createView({ chatHistoryManager: manager });
            Object.assign(restored.plugin, { writingVersions: versions });
            await restored.view.onOpen();
            for (let i = 0; i < 8; i++) await flushPromises();
            const openedRecoveries: WritingRecoveryModal[] = [];
            const openRecovery = jest.spyOn(WritingRecoveryModal.prototype, 'open').mockImplementation(function (this: WritingRecoveryModal) { openedRecoveries.push(this); });
            getElementByClass(restored.containerEl, 'pa-chat-writing-action').click();
            const recoveryModal = openedRecoveries[0];
            const modalRoot = new MockElement('div');
            recoveryModal.contentEl = modalRoot as unknown as HTMLElement;
            recoveryModal.onOpen();
            const areas = walkAll(modalRoot, (element) => element.tagName === 'textarea');
            const buttons = walkAll(modalRoot, (element) => element.tagName === 'button');
            Object.assign(areas[0], { selectionStart: 7, selectionEnd: 11 });
            buttons[0].click(); buttons[1].click();
            for (let i = 0; i < 8; i++) await flushPromises();
            const recovered = (await versions.list('resolved-writing'))[0];
            expect(recovered.text).toBe('BODY');
            expect(recovered.associatedImages.map((image) => image.ref)).toEqual([material.ref]);
            expect((await store.getTurns('resolved-writing'))[0].assistant.writingVersionId).toBe(recovered.id);
            recoveryModal.onClose();
            openRecovery.mockRestore();
            restored.view.prefillComposer('短一点');
            getElementByClass(restored.containerEl, 'send-button-visible').click();
            await flushPromises();
            expect(streamCalls[1].options.writingContext).toMatchObject({ parentVersionId: recovered.id,
                associatedImages: [{ ...material, ordinal: 1 }] });
            streamCalls[1].resolve();
        }
    });

    it.each([false, true])('inherits only the immediately preceding failed writing material on explicit continuation, including reopen: %s', async (reopen) => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'failed-material' });
        const versions = new WritingVersionService(store);
        let fixture = createView({ chatHistoryManager: manager });
        Object.assign(fixture.plugin, { writingVersions: versions });
        await fixture.view.onOpen();
        const material: MessageImage = { ordinal: 3, label: 'source.png', ref: { assetId: 'png', contentHash: 'a'.repeat(64) } };
        await store.putImageAsset({ id: material.ref.assetId, originalHash: material.ref.contentHash, source: 'vault_reference',
            originalPath: 'source.png', detectedMime: 'image/png', byteLength: 3, acquisition: 'original_file',
            anchorPath: 'PA Chat.md', anchorKind: 'logical_root', state: 'available', createdAt: 1, owners: [] });
        fixture.view.chatHistory.push({ role: 'user', content: 'unrelated HEIC question', images: [
            { ordinal: 1, label: 'source.heic', ref: { assetId: 'heic', contentHash: 'b'.repeat(64) } },
        ] }, { role: 'assistant', content: 'unrelated answer' });
        fixture.view.prefillComposer('写一段旅行文案');
        const draft = (fixture.view as unknown as { composerDraft: ComposerDraft<MessageImage> }).composerDraft;
        draft.completeImport(draft.beginImport(material.label), material);
        getElementByClass(fixture.containerEl, 'send-button-visible').click();
        await flushPromises();
        const failed = streamCalls[0];
        failed.options.onEvent?.({ version: 1, turnId: 'turn_1', seq: 10, timestamp: 1, runId: 'run_1',
            kind: 'writing-recovery', requestId: failed.options.writingRequest!.requestId,
            rawText: '{"body":""}', reason: 'invalid_output' });
        failed.resolve();
        for (let i = 0; i < 8; i++) await flushPromises();
        if (reopen) {
            await fixture.view.onClose();
            fixture = createView({ chatHistoryManager: manager });
            Object.assign(fixture.plugin, { writingVersions: versions });
            await fixture.view.onOpen();
            for (let i = 0; i < 8; i++) await flushPromises();
        }
        fixture.view.prefillComposer('继续刚才的文案任务：请重新查看第3张图片');
        getElementByClass(fixture.containerEl, 'send-button-visible').click();
        await flushPromises();
        expect(streamCalls[1].options).toMatchObject({ writingMaterialContext: {
            requestId: failed.options.writingRequest!.requestId, associatedImages: [material],
        } });
        expect(streamCalls[1].options.writingContext).toBeUndefined();
        streamCalls[1].resolve();
        for (let i = 0; i < 8; i++) await flushPromises();
        fixture.view.prefillComposer('换个话题，帮我写一封工作邮件');
        getElementByClass(fixture.containerEl, 'send-button-visible').click();
        await flushPromises();
        expect(streamCalls[2].options).not.toHaveProperty('writingMaterialContext', expect.anything());
        streamCalls[2].resolve();
    });

    it.each(['before_reopen', 'while_lookup', 'same_task'] as const)('keeps the restored writing parent within the current topic: %s', async (timing) => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'writing-topic-boundary' });
        const versions = new WritingVersionService(store);
        const material: MessageImage = { ordinal: 3, label: 'travel.png', ref: { assetId: 'travel', contentHash: 'a'.repeat(64) } };
        await store.putImageAsset({ id: material.ref.assetId, originalHash: material.ref.contentHash, source: 'vault_reference',
            originalPath: 'travel.png', detectedMime: 'image/png', byteLength: 3, acquisition: 'original_file',
            anchorPath: 'PA Chat.md', anchorKind: 'logical_root', state: 'available', createdAt: 1, owners: [] });
        let fixture = createView({ chatHistoryManager: manager });
        Object.assign(fixture.plugin, { writingVersions: versions });
        await fixture.view.onOpen();
        const send = async (text: string) => {
            fixture.view.prefillComposer(text);
            getElementByClass(fixture.containerEl, 'send-button-visible').click();
            await flushPromises();
            return streamCalls.at(-1)!;
        };
        const settle = async (call: StreamCall) => { call.resolve(); for (let i = 0; i < 8; i++) await flushPromises(); };
        const writing = await send('写一段旅行文案');
        writing.options.onEvent?.({ version: 1, turnId: 'turn_1', seq: 10, timestamp: 1, runId: 'run_1', kind: 'writing-artifact',
            requestId: writing.options.writingRequest!.requestId, messageId: 'travel-writing', body: 'Trip body', explanation: '', associatedImages: [material] });
        await settle(writing);
        expect((await versions.list('writing-topic-boundary'))[0].associatedImages).toHaveLength(1);
        const newTopic = async () => {
            const call = await send('换个话题，今天星期几？');
            expect(call.options.writingContext).toBeUndefined();
            call.onChunk('Today is Sunday.');
            await settle(call);
        };
        if (timing === 'before_reopen') await newTopic();
        await fixture.view.onClose();
        let release!: () => void;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        const readVersion = versions.get.bind(versions);
        const lookup = timing === 'while_lookup' ? jest.spyOn(versions, 'get').mockImplementation(async (id) => {
            const version = await readVersion(id); await pending; return version;
        }) : undefined;
        fixture = createView({ chatHistoryManager: manager });
        Object.assign(fixture.plugin, { writingVersions: versions });
        await fixture.view.onOpen();
        for (let i = 0; i < 8; i++) await flushPromises();
        if (lookup) {
            expect(lookup).toHaveBeenCalledTimes(1);
            await newTopic();
            release();
            for (let i = 0; i < 8; i++) await flushPromises();
            lookup.mockRestore();
        }
        const short = await send('短一点');
        if (timing === 'same_task') {
            expect(short.options.writingRequest).toBeDefined();
            expect(short.options.writingContext).toMatchObject({ text: 'Trip body', associatedImages: [{ ...material, ordinal: 1 }] });
        } else {
            expect(short.options.writingRequest).toBeUndefined();
            expect(short.options.writingContext).toBeUndefined();
        }
        expect(short.options.writingMaterialContext).toBeUndefined();
        await settle(short);
    });

    it('keeps the writing visible and discloses when its chat turn could not be persisted', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'history-failure-conversation' });
        jest.spyOn(manager, 'recordTurn').mockRejectedValue(new Error('IDB quota'));
        const versions = new WritingVersionService(store);
        const notices = (Notice as unknown as { messages: Array<{ message: unknown }> }).messages;
        const previousNoticeCount = notices.length;
        const { view, plugin, containerEl } = createView({ chatHistoryManager: manager });
        Object.assign(plugin, { writingVersions: versions });
        await view.onOpen();
        view.prefillComposer('写一段旅行文案');
        getElementByClass(containerEl, 'send-button-visible').click();
        await flushPromises();
        const call = streamCalls[0];
        call.options.onEvent?.({ version: 1, turnId: 'turn_1', seq: 10, timestamp: 1,
            kind: 'writing-artifact', runId: 'run_1', requestId: call.options.writingRequest!.requestId,
            messageId: 'writing_answer', body: 'Keep this exact writing.', explanation: '' });
        call.resolve();
        for (let i = 0; i < 8; i++) await flushPromises();
        expect(view.chatHistory[1].content).toBe('Keep this exact writing.');
        expect(await store.getTurns('history-failure-conversation')).toEqual([]);
        expect(notices.slice(previousNoticeCount).some((notice) => String(notice.message).includes('chat history could not be saved'))).toBe(true);
    });

    it.each(['cancel', 'error'])('keeps writing recovery after a thrown %s without accepting a candidate', async (failure) => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'failed-writing-conversation' });
        const versions = new WritingVersionService(store);
        const material: MessageImage = { ordinal: 3, label: 'source.png', ref: { assetId: 'png', contentHash: 'a'.repeat(64) } };
        await store.putImageAsset({ id: material.ref.assetId, originalHash: material.ref.contentHash, source: 'vault_reference',
            originalPath: 'source.png', detectedMime: 'image/png', byteLength: 3, acquisition: 'original_file',
            anchorPath: 'PA Chat.md', anchorKind: 'logical_root', state: 'available', createdAt: 1, owners: [] });
        const { view, plugin, containerEl } = createView({ chatHistoryManager: manager });
        Object.assign(plugin, { writingVersions: versions });
        await view.onOpen();
        view.prefillComposer('写一段旅行文案');
        getElementByClass(containerEl, 'send-button-visible').click();
        await flushPromises();
        const call = streamCalls[0];
        const rawText = '{"body":"中断的原始回答"';
        call.options.onEvent?.({ version: 1, turnId: 'turn_1', seq: 10, timestamp: 1,
            kind: 'writing-recovery', runId: 'run_1', requestId: call.options.writingRequest!.requestId,
            messageId: 'failed_answer', rawText, reason: 'incomplete', associatedImages: [material] });
        call.reject(failure === 'cancel' ? new DOMException('Cancelled', 'AbortError') : new Error('transport failed'));
        for (let i = 0; i < 8; i++) await flushPromises();
        expect(await versions.list('failed-writing-conversation')).toEqual([]);
        expect(view.chatHistory[1].writingRecovery?.rawText).toBe(rawText);
        expect(view.chatHistory[1].shareCardEligible).toBe(false);
        expect((await store.getTurns('failed-writing-conversation'))[0].assistant.writingRecovery?.rawText).toBe(rawText);
        expect((await store.getTurns('failed-writing-conversation'))[0].assistant.images).toEqual([material]);
        expect(allText(containerEl)).not.toContain(rawText);
        expect(getElementsByClass(containerEl, 'pa-chat-writing-action')).toHaveLength(1);
    });

    it.each(['artifact', 'recovery'] as const)('ignores a stale writing %s material receipt after closing the view', async (kind) => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'stale-writing' });
        const versions = new WritingVersionService(store);
        const { view, plugin, containerEl } = createView({ chatHistoryManager: manager });
        Object.assign(plugin, { writingVersions: versions });
        await view.onOpen();
        view.prefillComposer('写一段旅行文案');
        getElementByClass(containerEl, 'send-button-visible').click();
        await flushPromises();
        const stale = streamCalls[0];
        await view.onClose();
        const shared = { version: 1 as const, turnId: 'turn_1', seq: 10, timestamp: 1, runId: 'run_1',
            requestId: stale.options.writingRequest!.requestId, messageId: 'old-result', associatedImages: [
                { ordinal: 3, label: 'old.png', ref: { assetId: 'old-png', contentHash: 'a'.repeat(64) } },
            ] };
        stale.options.onEvent?.(kind === 'artifact' ? { ...shared, kind: 'writing-artifact', body: 'old body', explanation: '' }
            : { ...shared, kind: 'writing-recovery', rawText: 'old raw', reason: 'incomplete' });
        stale.resolve();
        for (let i = 0; i < 8; i++) await flushPromises();
        expect(await store.getTurns('stale-writing')).toEqual([]);
        expect(await versions.list('stale-writing')).toEqual([]);
    });

    it.each([false, true])('requires an explicit body selection and records actual edits: %s', async (edited) => {
        const commit = jest.fn(async (_text: string, _origin: WritingVersion['origin']) => ({ id: 'recovered' } as WritingVersion));
        const root = new MockElement('div');
        const modal = new WritingRecoveryModal({} as never, { requestId: 'request', rawText: 'prefix BODY suffix', reason: 'incomplete' },
            commit, { versions: {} as WritingVersionService });
        modal.contentEl = root as unknown as HTMLElement;
        modal.onOpen();
        const areas = walkAll(root, (element) => element.tagName === 'textarea');
        const buttons = walkAll(root, (element) => element.tagName === 'button');
        buttons[1].click();
        await flushPromises();
        expect(commit).not.toHaveBeenCalled();
        Object.assign(areas[0], { selectionStart: 7, selectionEnd: 11 });
        buttons[0].click();
        if (edited) areas[1].value = 'MY BODY';
        buttons[1].click();
        await flushPromises();
        expect(commit).toHaveBeenCalledWith(edited ? 'MY BODY' : 'BODY', edited ? 'user_edited' : 'ai_generated');
    });

    it('prepares all version images by default and releases a preview that completes after close', async () => {
        let resolvePrepare!: (prepared: PreparedWritingSave) => void;
        const prepare = jest.fn((_input: Parameters<WritingSaveAction['prepare']>[0]) => new Promise<PreparedWritingSave>((resolve) => { resolvePrepare = resolve; }));
        const execute = jest.fn();
        const save = { prepare, execute, listReceipts: async () => [] } as unknown as WritingSaveAction;
        const root = new MockElement('div');
        const images = [1, 2].map((ordinal) => ({ ordinal, label: `image-${ordinal}.png`, ref: { assetId: `asset-${ordinal}`, contentHash: 'a'.repeat(64) } }));
        const modal = new WritingSaveModal({} as never, save, { id: 'version', text: 'Exact body', associatedImages: images } as WritingVersion);
        modal.contentEl = root as unknown as HTMLElement;
        modal.onOpen();
        const preview = walkAll(root, (element) => element.tagName === 'button').at(-1)!;
        preview.click();
        expect(prepare.mock.calls[0][0].images).toEqual(images);
        expect(execute).not.toHaveBeenCalled();
        modal.onClose();
        expect(prepare.mock.calls[0][0].signal?.aborted).toBe(true);
        const release = jest.fn();
        resolvePrepare({ release } as unknown as PreparedWritingSave);
        await flushPromises();
        expect(release).toHaveBeenCalledTimes(1);
        expect(execute).not.toHaveBeenCalled();
    });

    it('keeps review-and-resume beside an incomplete save and retries the same operation', async () => {
        const receipt = { operationId: 'save-existing', targetNotePath: 'Chosen.md', attachments: [], state: 'partial' };
        const prepare = jest.fn(async () => ({ operationId: receipt.operationId, receipt, previewMarkdown: 'Exact body', release: jest.fn() }));
        const execute = jest.fn(async () => receipt);
        const retry = jest.fn(async (_operationId: string, _options?: { signal?: AbortSignal }) => ({ ...receipt, state: 'completed' }));
        const save = { prepare, execute, retry, listReceipts: async () => [] } as unknown as WritingSaveAction;
        const root = new MockElement('div');
        const modal = new WritingSaveModal({ vault: { getAbstractFileByPath: () => null } } as unknown as App,
            save, { id: 'version', text: 'Exact body', associatedImages: [] } as unknown as WritingVersion);
        modal.contentEl = root as unknown as HTMLElement; modal.onOpen();
        getButtonByText(root, 'Preview saving').click(); await flushPromises();
        getButtonByText(root, 'Save this exact selection').click(); await flushPromises();
        getButtonByText(root, 'Review and resume this save').click(); await flushPromises();
        expect(retry).toHaveBeenCalledWith('save-existing', expect.objectContaining({ signal: expect.any(AbortSignal) }));
        expect(getButtonsByText(root, 'Review and resume this save')).toHaveLength(0);
        expect(prepare).toHaveBeenCalledTimes(1);
        modal.onClose();
    });

    it('shows exact reference samples separately, refreshes without losing edits, and cancels stale reads', async () => {
        const first = { id: 'first', conversationId: 'chat', text: 'Exact body', explanation: 'Separate explanation',
            requestId: 'request', messageId: 'message', textHash: 'a'.repeat(64), turnIndex: 0, createdAt: 0,
            origin: 'ai_generated', referenceScope: 'request', associatedImages: [],
            backgroundSourceRefs: [{ path: 'Travel.md', heading: 'Day one' }], styleRevisionIds: ['style-1'] } as WritingVersion;
        const second = { ...first, id: 'second', text: 'Second body', styleRevisionIds: ['missing'] };
        const references = [{ revisionId: 'style-1', exactText: '  Exact sample\nwith spacing  ',
            scene: { writingTask: 'copywriting', purpose: 'social_share', audience: 'friends', domain: 'travel' }, isCurrent: () => true }];
        const read = jest.fn(async (_ids: readonly string[], _signal?: AbortSignal) => references);
        let changed: () => void = () => undefined;
        const unsubscribe = jest.fn();
        const root = new MockElement('div');
        const modal = new WritingVersionModal({} as never, {
            versions: { get: async (id: string) => id === 'first' ? first : second, list: async () => [first, second],
                edit: jest.fn(async (_id, text) => ({ ...first, text })) } as unknown as WritingVersionService,
            readStyleReferences: read, onReferencesChanged: (listener) => { changed = listener; return unsubscribe; },
        }, first.id);
        modal.contentEl = root as unknown as HTMLElement; modal.onOpen(); await flushPromises();
        const material = walkAll(root, (el) => el.tagName === 'details')[0] as unknown as HTMLDetailsElement;
        material.open = true; material.ontoggle?.({} as ToggleEvent); await flushPromises();
        expect(walkAll(root, (el) => el.tagName === 'h3').map((el) => el.textContent))
            .toEqual(['Associated images (0)', 'Background sources (1)', 'Style samples (1)']);
        expect(walk(root, (el) => el.tagName === 'pre')?.textContent).toBe(references[0].exactText);
        expect(walk(root, (el) => el.textContent === 'Travel.md › Day one')).not.toBeNull();
        const editor = walk(root, (el) => el.tagName === 'textarea')!; editor.value = 'Unsaved edit';
        walk(root, (el) => el.tagName === 'button' && el.textContent === 'Copy writing')!.click();
        await flushPromises();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Unsaved edit');
        let finish!: (value: typeof references) => void;
        read.mockImplementationOnce(async () => new Promise((resolve) => { finish = resolve; }));
        changed(); expect(walk(root, (el) => el.tagName === 'pre')).toBeNull();
        expect(editor.value).toBe('Unsaved edit');
        const picker = walk(root, (el) => el.tagName === 'select')! as unknown as HTMLSelectElement;
        picker.value = 'second'; picker.onchange?.({} as Event); await flushPromises();
        expect(read.mock.calls[1][1]?.aborted).toBe(true);
        finish(references); await flushPromises();
        expect(walk(root, (el) => el.tagName === 'pre')).toBeNull();
        expect(walk(root, (el) => el.tagName === 'textarea')?.value).toBe('Second body');
        const nextDetails = walkAll(root, (el) => el.tagName === 'details')[0] as unknown as HTMLDetailsElement;
        nextDetails.open = true; nextDetails.ontoggle?.({} as ToggleEvent); await flushPromises();
        expect(walk(root, (el) => el.textContent.includes('Reference unavailable'))).not.toBeNull();
        expect(walk(root, (el) => el.tagName === 'pre')).toBeNull();
        modal.onClose(); expect(unsubscribe).toHaveBeenCalledTimes(2);
        expect(read.mock.calls[2][1]?.aborted).toBe(true);
    });

    it.each(['legacy_memory', 'governance_unavailable'] as const)('keeps the style choice and explains its Memory blocker: %s', async (code) => {
        const remember = jest.fn(async () => { throw new WritingStyleUnavailableError(code); });
        const root = new MockElement('div');
        const version = { id: 'version', text: 'Exact text', scene: {
            writingTask: 'copywriting', purpose: 'social_share', audience: 'friends', domain: 'travel',
        } } as WritingVersion;
        const modal = new WritingStyleModal({} as never, version, remember);
        modal.contentEl = root as unknown as HTMLElement;
        modal.onOpen();
        const accept = walkAll(root, (element) => element.tagName === 'button')[0];
        accept.click();
        await flushPromises();
        expect(remember).toHaveBeenCalledTimes(1);
        expect(accept.disabled).toBe(false);
        expect(walk(root, (element) => element.getAttribute('role') === 'status')?.textContent)
            .toContain(code === 'legacy_memory' ? 'older compatibility mode' : 'not ready');
        expect(walk(root, (element) => element.tagName === 'pre')?.textContent).toBe('Exact text');
        expect(walkAll(root, (element) => element.tagName === 'input')).toHaveLength(4);
        modal.onClose();
    });

    it('protects image-only and pending drafts from Pagelet and external prefills', async () => {
        const { view } = createView();
        await view.onOpen();
        const draft = (view as unknown as { composerDraft: ComposerDraft<MessageImage> }).composerDraft;
        const handle = draft.beginImport('photo.jpg');
        await expect(view.preparePageletHandoff(createPageletHandoffContext())).resolves.toEqual({ status: 'draft-conflict' });
        expect(view.prefillComposer('unrelated save suggestion')).toBe(false);
        draft.completeImport(handle, { ref: { assetId: 'asset-1', contentHash: 'a'.repeat(64) }, label: 'photo.jpg', ordinal: 1 });
        await expect(view.preparePageletHandoff(createPageletHandoffContext())).resolves.toEqual({ status: 'draft-conflict' });
        await view.onClose();
        expect(draft.hasDraft('')).toBe(false);
    });

    function attachDisclosureService(context: ReturnType<typeof createView>, store: MemoryChatHistoryStore) {
        Object.assign(context.app.vault, { on: jest.fn(), offref: jest.fn() });
        const service = new ImageAssetService(context.app as unknown as App, store, {
            processor: { process: jest.fn(async () => { throw new Error('unused'); }), dispose: async () => undefined },
        });
        Object.assign(context.plugin, { imageAssetService: service });
        const ref = { assetId: 'disclosure-image', contentHash: 'a'.repeat(64) };
        jest.spyOn(service, 'resolveVariant').mockResolvedValue({ blob: new Blob(['preview']), mime: 'image/jpeg',
            width: 1, height: 1, persistent: false, release: () => undefined });
        return { service, ref };
    }

    it.each(['heic-unsupported', 'image_assets:heic_unsupported'])(
        'explains unsupported HEIC import and retains the text draft: %s', async (code) => {
            const context = createView();
            const { service } = attachDisclosureService(context, new MemoryChatHistoryStore());
            const importFile = jest.spyOn(service, 'importFile').mockRejectedValue(new Error(code));
            try {
                await context.view.onOpen();
                const editor = getTextArea(context.containerEl);
                editor.value = 'Keep my caption';
                editor.dispatchEvent('paste', { clipboardData: { files: [
                    new File(['heic'], 'photo.heic', { type: 'image/heic' }),
                ] }, preventDefault: jest.fn() });
                for (let i = 0; i < 5; i++) await flushPromises();
                expect(importFile).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ acquisition: 'original_file' }));
                expect(editor.value).toBe('Keep my caption');
                expect(allText(getElementByClass(context.containerEl, 'pa-chat-image-draft'))).toContain('Convert the image to JPEG');
                expect(service.resolveVariant).not.toHaveBeenCalled();
            } finally { await context.view.onClose(); await service.dispose(); }
        });

    it('renders pasted images once inside the composer and opens local details before original access', async () => {
        const context = createView();
        const { service, ref } = attachDisclosureService(context, new MemoryChatHistoryStore());
        const importFile = jest.spyOn(service, 'importFile').mockImplementation(async (file) => ({
            ref: { ...ref, assetId: file.name }, asset: { acquisition: 'unverified_import' },
        }) as Awaited<ReturnType<ImageAssetService['importFile']>>);
        const readOriginal = jest.spyOn(service, 'readOriginal');
        const detailRoot = new MockElement('div');
        let detail: ImageAttachmentDetailModal | undefined;
        const open = jest.spyOn(ImageAttachmentDetailModal.prototype, 'open').mockImplementation(function (this: ImageAttachmentDetailModal) {
            detail = this;
            this.contentEl = detailRoot as unknown as HTMLElement;
            this.onOpen();
        });
        const close = jest.spyOn(ImageAttachmentDetailModal.prototype, 'close').mockImplementation(function (this: ImageAttachmentDetailModal) { this.onClose(); });
        try {
            await context.view.onOpen();
            const editor = getTextArea(context.containerEl);
            const preventDefault = jest.fn();
            editor.dispatchEvent('paste', { clipboardData: { files: [
                new File(['a'], 'first.png', { type: 'image/png' }),
                new File(['b'], 'second.png', { type: 'image/png' }),
            ] }, preventDefault });
            expect(preventDefault).toHaveBeenCalledTimes(1);
            const draftEl = getElementByClass(context.containerEl, 'pa-chat-image-draft');
            expect(draftEl.parentElement).toBe(getElementByClass(context.containerEl, 'pa-chat-composer-row'));
            expect(draftEl.parentElement?.children[0]).toBe(draftEl);
            expect(getElementByClass(context.containerEl, 'send-button-visible').disabled).toBe(true);
            for (let i = 0; i < 6; i++) await flushPromises();
            const entries = walkAll(draftEl, (element) => element.classList.contains('pa-chat-image-draft__item'));
            expect(entries).toHaveLength(2);
            expect(entries.map((entry) => entry.getAttribute('data-status'))).toEqual(['ready', 'ready']);
            expect(walkAll(draftEl, (element) => element.tagName === 'img')).toHaveLength(2);
            expect(walkAll(draftEl, (element) => element.tagName === 'button')).toHaveLength(4);
            expect(walk(draftEl, (element) => element.classList.contains('pa-chat-images'))).toBeNull();
            expect(allText(draftEl)).not.toContain('original format');
            expect(getButtonsByText(context.containerEl, 'Add original from Files')).toHaveLength(0);
            expect(importFile.mock.calls.map((call) => call[1]?.acquisition)).toEqual(['original_file', 'original_file']);
            expect(getElementByClass(context.containerEl, 'send-button-visible').disabled).toBe(false);
            getElementByClass(entries[0], 'pa-chat-image-draft__preview').click();
            await flushPromises();
            expect(open).toHaveBeenCalledTimes(1);
            expect(detail).toBeDefined();
            expect(readOriginal).not.toHaveBeenCalled();
            expect(allText(detailRoot)).toContain('first.png');
            expect(allText(detailRoot)).not.toContain('original format is unverified');
            editor.value = 'Continue editing';
            const documentWithFocus = { activeElement: null as MockElement | null };
            Object.defineProperty(globalThis, 'document', { configurable: true, value: documentWithFocus });
            const remove = getElementByClass(entries[0], 'pa-chat-image-draft__remove');
            remove.focus();
            remove.click();
            expect(documentWithFocus.activeElement).toBe(editor);
            expect(editor.value).toBe('Continue editing');
            expect(close).toHaveBeenCalledTimes(1);
            expect(walkAll(draftEl, (element) => element.classList.contains('pa-chat-image-draft__item'))).toHaveLength(1);
        } finally {
            await context.view.onClose();
            await service.dispose();
            open.mockRestore(); close.mockRestore(); readOriginal.mockRestore(); importFile.mockRestore();
        }
    });

    it('explains an unavailable historical HEIC preview while retaining original access', async () => {
        const context = createView();
        const { service, ref } = attachDisclosureService(context, new MemoryChatHistoryStore());
        jest.mocked(service.resolveVariant).mockRejectedValue(new Error('heic-unsupported'));
        const root = new MockElement('div');
        const modal = new ImageAttachmentDetailModal(context.app as unknown as App,
            { ref, ordinal: 1, label: 'historical.heic' }, service);
        modal.contentEl = root as unknown as HTMLElement;
        try {
            modal.onOpen(); await flushPromises();
            expect(allText(root)).toContain('Convert the image to JPEG');
            expect(getElementByClass(root, 'pa-chat-image__preview').disabled).toBe(false);
            expect(allText(root)).not.toContain('original format is unverified');
        } finally { modal.onClose(); await service.dispose(); }
    });

    it.each(['success', 'source_missing', 'open_failed'] as const)(
        'closes image details only after its original opens and preserves recovery on failure: %s', async (outcome) => {
            const root = new MockElement('div');
            const image = { ref: { assetId: 'detail-image', contentHash: 'a'.repeat(64) }, ordinal: 1, label: 'source.png' };
            const release = jest.fn();
            const readOriginal = jest.fn(async (..._args: Parameters<ImageAssetService['readOriginal']>) => {
                if (outcome === 'source_missing') throw new Error('source_missing');
                return { asset: { originalPath: 'originals/source.png' } };
            });
            const service = {
                resolveVariant: jest.fn(async () => ({ blob: new Blob(['preview']), width: 1, height: 1, release })),
                readOriginal,
            } as unknown as ImageAssetService;
            let finishOpen!: () => void;
            const openLinkText = jest.fn(async (..._args: Parameters<App['workspace']['openLinkText']>) => {
                if (outcome === 'open_failed') throw new Error('workspace unavailable');
                return new Promise<void>((resolve) => { finishOpen = resolve; });
            });
            const modal = new ImageAttachmentDetailModal({ workspace: { openLinkText } } as unknown as App, image, service);
            modal.contentEl = root as unknown as HTMLElement;
            const close = jest.spyOn(modal, 'close').mockImplementation(() => modal.onClose());
            const revokeUrl = jest.spyOn(URL, 'revokeObjectURL');
            try {
                modal.onOpen();
                await flushPromises();
                const preview = getElementByClass(root, 'pa-chat-image__preview');
                preview.click();
                await flushPromises();
                expect(readOriginal).toHaveBeenCalledWith(image.ref, 'preview');
                expect(close).not.toHaveBeenCalled();
                expect(release).not.toHaveBeenCalled();
                if (outcome === 'success') {
                    expect(openLinkText).toHaveBeenCalledWith('originals/source.png', '', false);
                    finishOpen();
                    await flushPromises();
                    expect(close).toHaveBeenCalledTimes(1);
                    expect(root.children).toHaveLength(0);
                    expect(release).toHaveBeenCalledTimes(1);
                    expect(revokeUrl).toHaveBeenCalledTimes(1);
                } else {
                    expect(openLinkText).toHaveBeenCalledTimes(outcome === 'source_missing' ? 0 : 1);
                    expect(getElementByClass(root, 'pa-chat-image__status').textContent).toContain('Original unavailable');
                    expect(getButtonByText(root, 'Locate the original').hidden).toBe(false);
                    expect(root.children.length).toBeGreaterThan(0);
                }
                modal.onClose();
                expect(release).toHaveBeenCalledTimes(1);
                expect(revokeUrl).toHaveBeenCalledTimes(1);
            } finally {
                modal.onClose();
                close.mockRestore(); revokeUrl.mockRestore();
            }
        },
    );

    it('keeps a failed pasted image visible and removable while blocking send', async () => {
        const context = createView();
        const { service } = attachDisclosureService(context, new MemoryChatHistoryStore());
        const importFile = jest.spyOn(service, 'importFile').mockRejectedValue(new Error('cannot preserve image'));
        try {
            await context.view.onOpen();
            const editor = getTextArea(context.containerEl);
            editor.value = 'Keep this text';
            editor.dispatchEvent('paste', { clipboardData: { files: [new File(['a'], 'broken.png', { type: 'image/png' })] }, preventDefault: jest.fn() });
            let entry = getElementByClass(context.containerEl, 'pa-chat-image-draft__item');
            expect(entry.getAttribute('data-status')).toBe('processing');
            expect(getElementByClass(entry, 'pa-chat-image-draft__status').textContent).toBeTruthy();
            expect(getElementByClass(context.containerEl, 'send-button-visible').disabled).toBe(true);
            for (let i = 0; i < 4; i++) await flushPromises();
            entry = getElementByClass(context.containerEl, 'pa-chat-image-draft__item');
            expect(entry.getAttribute('data-status')).toBe('error');
            const status = getElementByClass(entry, 'pa-chat-image-draft__status');
            expect(status.getAttribute('role')).toBe('status');
            expect(status.textContent).toContain('add it again');
            expect(getElementByClass(context.containerEl, 'send-button-visible').disabled).toBe(true);
            expect(getElementByClass(entry, 'pa-chat-image-draft__preview').disabled).toBe(true);
            getElementByClass(entry, 'pa-chat-image-draft__remove').click();
            expect(getElementByClass(context.containerEl, 'pa-chat-image-draft').hidden).toBe(true);
            expect(getElementByClass(context.containerEl, 'send-button-visible').disabled).toBe(false);
            expect(editor.value).toBe('Keep this text');
            expect(mockStreamLLM).not.toHaveBeenCalled();
        } finally {
            await context.view.onClose();
            await service.dispose();
            importFile.mockRestore();
        }
    });

    it.each(['ready', 'error'] as const)(
        'reveals new image imports and failures while preserving ordinary draft scrolling: %s', async (outcome) => {
            const context = createView();
            const { service, ref } = attachDisclosureService(context, new MemoryChatHistoryStore());
            const sourceOpen = jest.spyOn(ImageSourcePickerModal.prototype, 'open').mockImplementation(function (this: ImageSourcePickerModal) {
                this.contentEl = new MockElement('div') as unknown as HTMLElement;
                this.onOpen();
                getButtonByText(this.contentEl as unknown as MockElement, 'From Files').click();
            });
            type Imported = Awaited<ReturnType<ImageAssetService['importFile']>>;
            const imported = { ref, asset: { acquisition: 'original_file' } } as Imported;
            let finishImport!: (value: Imported) => void;
            let failImport!: (reason: Error) => void;
            const importFile = jest.spyOn(service, 'importFile').mockImplementation(async (file) => {
                if (file.name === 'eighth.png') {
                    return new Promise<Imported>((resolve, reject) => { finishImport = resolve; failImport = reject; });
                }
                return imported;
            });
            const originalBounds = MockElement.prototype.getBoundingClientRect;
            const bounds = jest.spyOn(MockElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: MockElement) {
                if (this.classList.contains('pa-chat-image-draft__item') && this.parentElement) {
                    const index = this.parentElement.children.indexOf(this);
                    const width = this.getAttribute('data-status') === 'error' ? 248 : 84;
                    const left = index * 92 - this.parentElement.scrollLeft;
                    return { left, right: left + width, top: 0, bottom: 84, width, height: 84 };
                }
                return originalBounds.call(this);
            });
            try {
                await context.view.onOpen();
                const editor = getTextArea(context.containerEl);
                const draftEl = getElementByClass(context.containerEl, 'pa-chat-image-draft');
                draftEl.clientWidth = 300;
                const originalEmpty = draftEl.empty.bind(draftEl);
                jest.spyOn(draftEl, 'empty').mockImplementation(() => {
                    originalEmpty();
                    // Browsers clamp scrollLeft when the entire strip is temporarily emptied.
                    draftEl.scrollLeft = 0;
                });
                editor.dispatchEvent('paste', { clipboardData: { files: Array.from({ length: 7 }, (_, index) =>
                    new File(['image'], `${index}.png`, { type: 'image/png' })) }, preventDefault: jest.fn() });
                for (let i = 0; i < 6; i++) await flushPromises();
                expect(draftEl.children).toHaveLength(7);
                draftEl.scrollLeft = 190;
                draftEl.scrollTop = 37;
                const documentWithFocus = { activeElement: editor as MockElement | null };
                Object.defineProperty(globalThis, 'document', { configurable: true, value: documentWithFocus });
                getButtonByClass(context.containerEl, 'pa-chat-add-images').click();
                const picker = walkAll(context.containerEl, (element) => element.getAttribute('type') === 'file')[1];
                Object.assign(picker, { files: [new File(['invalid'], 'eighth.png', { type: 'image/png' })] });
                (picker as unknown as { onchange: () => void }).onchange();
                await flushPromises();
                expect(draftEl.children).toHaveLength(8);
                expect(draftEl.children[7].getBoundingClientRect().right).toBeLessThanOrEqual(300);
                expect(draftEl.children[7].getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
                // The user may browse older images while this import is pending.
                draftEl.scrollLeft = 200;
                if (outcome === 'error') failImport(new Error('invalid PNG'));
                else finishImport(imported);
                for (let i = 0; i < 4; i++) await flushPromises();
                expect(draftEl.children[7].getAttribute('data-status')).toBe(outcome);
                if (outcome === 'error') {
                    expect(draftEl.children[7].getBoundingClientRect().right).toBeLessThanOrEqual(300);
                    expect(draftEl.children[7].getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
                    expect(getElementByClass(context.containerEl, 'send-button-visible').disabled).toBe(true);
                } else expect(draftEl.scrollLeft).toBe(200);
                expect(draftEl.scrollTop).toBe(37);
                expect(documentWithFocus.activeElement).toBe(editor);
            } finally {
                await context.view.onClose();
                await service.dispose();
                bounds.mockRestore(); importFile.mockRestore(); sourceOpen.mockRestore();
            }
        },
    );

    it.each(['keep', 'remove', 'close'] as const)(
        'reveals a remaining early batch failure after later imports finish, excluding removed or closed drafts: %s', async (disposition) => {
            const context = createView();
            const { service, ref } = attachDisclosureService(context, new MemoryChatHistoryStore());
            type Imported = Awaited<ReturnType<ImageAssetService['importFile']>>;
            const imported = { ref, asset: { acquisition: 'original_file' } } as Imported;
            let finishLastImport!: (value: Imported) => void;
            const importFile = jest.spyOn(service, 'importFile').mockImplementation(async (file) => {
                if (file.name === '0.png') throw new Error('invalid PNG');
                if (file.name === '7.png') return new Promise<Imported>((resolve) => { finishLastImport = resolve; });
                return imported;
            });
            const originalBounds = MockElement.prototype.getBoundingClientRect;
            const bounds = jest.spyOn(MockElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: MockElement) {
                if (this.classList.contains('pa-chat-image-draft__item') && this.parentElement) {
                    const index = this.parentElement.children.indexOf(this);
                    const widthOf = (item: MockElement) => item.getAttribute('data-status') === 'error' ? 248 : 84;
                    const offset = this.parentElement.children.slice(0, index).reduce((left, item) => left + widthOf(item) + 8, 0);
                    const left = offset - this.parentElement.scrollLeft;
                    const width = widthOf(this);
                    return { left, right: left + width, top: 0, bottom: 84, width, height: 84 };
                }
                return originalBounds.call(this);
            });
            try {
                await context.view.onOpen();
                const editor = getTextArea(context.containerEl);
                const draftEl = getElementByClass(context.containerEl, 'pa-chat-image-draft');
                draftEl.clientWidth = 300;
                const documentWithFocus = { activeElement: editor as MockElement | null };
                Object.defineProperty(globalThis, 'document', { configurable: true, value: documentWithFocus });
                editor.dispatchEvent('paste', { clipboardData: { files: Array.from({ length: 8 }, (_, index) =>
                    new File(['image'], `${index}.png`, { type: 'image/png' })) }, preventDefault: jest.fn() });
                for (let i = 0; i < 6; i++) await flushPromises();
                expect(draftEl.children).toHaveLength(8);
                expect(draftEl.children[0].getAttribute('data-status')).toBe('error');
                expect(draftEl.children[7].getAttribute('data-status')).toBe('processing');
                expect(draftEl.children[0].getBoundingClientRect().right).toBeLessThan(0);
                const draft = (context.view as unknown as { composerDraft: ComposerDraft<MessageImage> }).composerDraft;
                if (disposition === 'remove') getElementByClass(draftEl.children[0], 'pa-chat-image-draft__remove').click();
                if (disposition === 'close') await context.view.onClose();
                draftEl.scrollLeft = 200;
                finishLastImport(imported);
                for (let i = 0; i < 4; i++) await flushPromises();
                if (disposition === 'keep') {
                    expect(draftEl.children[0].getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
                    expect(draftEl.children[0].getBoundingClientRect().right).toBeLessThanOrEqual(300);
                    expect(getElementByClass(context.containerEl, 'send-button-visible').disabled).toBe(true);
                    expect(draftEl.children.slice(1).every((entry) => entry.getAttribute('data-status') === 'ready')).toBe(true);
                } else {
                    expect(draftEl.scrollLeft).toBe(200);
                    expect(draft.snapshot('').images.some((entry) => entry.status === 'error')).toBe(false);
                }
                if (disposition !== 'close') expect(documentWithFocus.activeElement).toBe(editor);
            } finally {
                await context.view.onClose();
                await service.dispose();
                bounds.mockRestore(); importFile.mockRestore();
            }
        },
    );

    it('releases a pasted thumbnail lease that arrives after its item is removed', async () => {
        const context = createView();
        const { service, ref } = attachDisclosureService(context, new MemoryChatHistoryStore());
        const importFile = jest.spyOn(service, 'importFile').mockResolvedValue({
            ref, asset: { acquisition: 'original_file' },
        } as Awaited<ReturnType<ImageAssetService['importFile']>>);
        type Lease = Awaited<ReturnType<ImageAssetService['resolveVariant']>>;
        let finishPreview!: (lease: Lease) => void;
        let previewSignal: AbortSignal | undefined;
        const preparationRelease = jest.fn();
        const thumbnailRelease = jest.fn();
        const lease = { blob: new Blob(['preview']), mime: 'image/jpeg', width: 1, height: 1, persistent: false, release: preparationRelease };
        jest.spyOn(service, 'resolveVariant').mockReset()
            .mockResolvedValueOnce(lease)
            .mockImplementationOnce((_ref, _purpose, options) => {
                previewSignal = options?.signal;
                return new Promise<Lease>((resolve) => { finishPreview = resolve; });
            });
        const createUrl = jest.spyOn(URL, 'createObjectURL');
        try {
            await context.view.onOpen();
            getTextArea(context.containerEl).dispatchEvent('paste', {
                clipboardData: { files: [new File(['a'], 'late.png', { type: 'image/png' })] }, preventDefault: jest.fn(),
            });
            for (let i = 0; i < 4; i++) await flushPromises();
            expect(preparationRelease).toHaveBeenCalledTimes(1);
            getElementByClass(context.containerEl, 'pa-chat-image-draft__remove').click();
            expect(previewSignal?.aborted).toBe(true);
            finishPreview({ ...lease, release: thumbnailRelease });
            await flushPromises();
            expect(thumbnailRelease).toHaveBeenCalledTimes(1);
            expect(createUrl).not.toHaveBeenCalled();
            expect(getElementByClass(context.containerEl, 'pa-chat-image-draft').children).toHaveLength(0);
            await context.view.onClose();
            expect(thumbnailRelease).toHaveBeenCalledTimes(1);
        } finally {
            await context.view.onClose();
            await service.dispose();
            createUrl.mockRestore(); importFile.mockRestore();
        }
    });

    it.each([false, true])('offers device-appropriate image sources and ignores a cancelled choice (mobile: %s)', (mobile) => {
        const wasMobile = Platform.isMobileApp;
        Object.assign(Platform, { isMobileApp: mobile });
        try {
            const choose = jest.fn();
            const modal = new ImageSourcePickerModal({} as App, choose);
            const root = new MockElement('div');
            modal.contentEl = root as unknown as HTMLElement;
            modal.onOpen();
            const choices = walkAll(root, el => el.tagName === 'button');
            expect(choices.map(button => button.textContent)).toEqual(mobile
                ? ['Choose photos', 'From Files', 'From vault'] : ['From Files', 'From vault']);
            modal.onClose();
            choices[0].click();
            expect(choose).not.toHaveBeenCalled();
        } finally { Object.assign(Platform, { isMobileApp: wasMobile }); }
    });

    it.each(['Choose photos', 'From Files', 'From vault'])('routes the single image button through %s', async (source) => {
        const wasMobile = Platform.isMobileApp;
        Object.assign(Platform, { isMobileApp: true });
        const context = createView();
        Object.assign(context.plugin, { imageAssetService: {} });
        let picker: ImageSourcePickerModal | undefined;
        const sourceOpen = jest.spyOn(ImageSourcePickerModal.prototype, 'open').mockImplementation(function (this: ImageSourcePickerModal) {
            picker = this; this.contentEl = new MockElement('div') as unknown as HTMLElement; this.onOpen();
        });
        const vaultOpen = jest.spyOn(VaultImagePickerModal.prototype, 'open').mockImplementation(() => undefined);
        try {
            await context.view.onOpen();
            const inputs = walkAll(context.containerEl, element => element.getAttribute('type') === 'file');
            const photosClick = jest.spyOn(inputs[0], 'click');
            const filesClick = jest.spyOn(inputs[1], 'click');
            getButtonByClass(context.containerEl, 'pa-chat-add-images').click();
            expect(photosClick).not.toHaveBeenCalled(); expect(filesClick).not.toHaveBeenCalled();
            getButtonByText(picker!.contentEl as unknown as MockElement, source).click();
            expect(photosClick).toHaveBeenCalledTimes(source === 'Choose photos' ? 1 : 0);
            expect(filesClick).toHaveBeenCalledTimes(source === 'From Files' ? 1 : 0);
            expect(vaultOpen).toHaveBeenCalledTimes(source === 'From vault' ? 1 : 0);
            await context.view.onClose();
            getButtonByText(picker!.contentEl as unknown as MockElement, source).click();
            expect(photosClick).toHaveBeenCalledTimes(source === 'Choose photos' ? 1 : 0);
            expect(filesClick).toHaveBeenCalledTimes(source === 'From Files' ? 1 : 0);
            expect(vaultOpen).toHaveBeenCalledTimes(source === 'From vault' ? 1 : 0);
        } finally {
            sourceOpen.mockRestore(); vaultOpen.mockRestore();
            Object.assign(Platform, { isMobileApp: wasMobile });
            await context.view.onClose();
        }
    });

    it.each(['files', 'vault'] as const)('discloses before the first %s image and not on later imports or view/service reopen', async (firstEntry) => {
        const store = new MemoryChatHistoryStore();
        const notices = (Notice as unknown as { messages: Array<{ message: unknown }> }).messages;
        const initial = notices.length;
        const providerNotices = () => notices.slice(initial).filter((item) => String(item.message).includes('AI provider receives'));
        const contexts: Array<ReturnType<typeof createView>> = [];
        const services: ImageAssetService[] = [];
        let sourceChoice = 'From vault';
        const sourceOpen = jest.spyOn(ImageSourcePickerModal.prototype, 'open').mockImplementation(function (this: ImageSourcePickerModal) {
            this.contentEl = new MockElement('div') as unknown as HTMLElement;
            this.onOpen();
            getButtonByText(this.contentEl as unknown as MockElement, sourceChoice).click();
        });
        const originalOpen = jest.spyOn(VaultImagePickerModal.prototype, 'open').mockImplementation(function (this: VaultImagePickerModal) {
            this.contentEl = new MockElement('div') as unknown as HTMLElement;
            this.onOpen();
            getButtonByText(this.contentEl as unknown as MockElement, 'synthetic-source.png').click();
        });
        try {
            for (const [index, entry] of [firstEntry, firstEntry === 'files' ? 'vault' : 'files', 'files'].entries()) {
                const reopening = index !== 1;
                const context = reopening ? createView() : contexts.at(-1)!;
                let service = services.at(-1)!;
                if (reopening) {
                    contexts.push(context);
                    const attached = attachDisclosureService(context, store); service = attached.service; services.push(service);
                    const asset = { acquisition: 'original_file' } as Awaited<ReturnType<ImageAssetService['importFile']>>['asset'];
                    const assertDisclosed = () => {
                        expect(providerNotices()).toHaveLength(1);
                        expect(String(providerNotices()[0].message)).toContain('does not hide visible text');
                        expect(String(providerNotices()[0].message)).toContain('Original files are kept unchanged');
                    };
                    jest.spyOn(service, 'importFile').mockImplementation(async () => { assertDisclosed(); return { ref: attached.ref, asset } as Awaited<ReturnType<ImageAssetService['importFile']>>; });
                    jest.spyOn(service, 'addVaultReference').mockImplementation(async () => { assertDisclosed(); return { ref: attached.ref, asset }; });
                    Object.assign(context.app.vault, { getFiles: () => [Object.assign(new TFile(), { path: 'synthetic-source.png', name: 'synthetic-source.png' })] });
                    await context.view.onOpen();
                }
                if (entry === 'files') {
                    sourceChoice = 'From Files';
                    getButtonByClass(context.containerEl, 'pa-chat-add-images').click();
                    const input = walkAll(context.containerEl, (element) => element.getAttribute('type') === 'file')[1];
                    Object.assign(input, { files: [{ name: 'synthetic-source.png' }] });
                    (input as unknown as { onchange: () => void }).onchange();
                } else {
                    sourceChoice = 'From vault';
                    getButtonByClass(context.containerEl, 'pa-chat-add-images').click();
                }
                for (let i = 0; i < 5; i++) await flushPromises();
                expect(providerNotices()).toHaveLength(1);
                expect(mockStreamLLM).not.toHaveBeenCalled();
                if (index === 1) { await context.view.onClose(); await service.dispose(); }
            }
        } finally {
            originalOpen.mockRestore();
            sourceOpen.mockRestore();
            for (const context of contexts) await context.view.onClose();
            for (const service of services) await service.dispose();
        }
    });

    it.each(['Choose photos', 'From Files'])('rejects stale/cancelled %s results and allows a fresh selection', async (source) => {
        const wasMobile = Platform.isMobileApp;
        Object.assign(Platform, { isMobileApp: true });
        const context = createView();
        const { service, ref } = attachDisclosureService(context, new MemoryChatHistoryStore());
        const importFile = jest.spyOn(service, 'importFile').mockResolvedValue({ ref,
            asset: { acquisition: source === 'Choose photos' ? 'unverified_import' : 'original_file' },
        } as Awaited<ReturnType<ImageAssetService['importFile']>>);
        const sourceOpen = jest.spyOn(ImageSourcePickerModal.prototype, 'open').mockImplementation(function (this: ImageSourcePickerModal) {
            this.contentEl = new MockElement('div') as unknown as HTMLElement; this.onOpen();
            getButtonByText(this.contentEl as unknown as MockElement, source).click();
        });
        try {
            await context.view.onOpen(); await flushPromises();
            const input = walkAll(context.containerEl, element => element.getAttribute('type') === 'file')[source === 'Choose photos' ? 0 : 1];
            const choose = () => getButtonByClass(context.containerEl, 'pa-chat-add-images').click();
            const deliver = () => {
                Object.assign(input, { files: [{ name: 'selected.png' }] });
                (input as unknown as { onchange: () => void }).onchange();
            };
            choose();
            (context.view as unknown as { composerDraft: ComposerDraft<MessageImage> }).composerDraft.clear();
            deliver(); await flushPromises();
            expect(importFile).not.toHaveBeenCalled();
            choose();
            input.dispatchEvent('cancel', { currentTarget: input });
            deliver(); await flushPromises();
            expect(importFile).not.toHaveBeenCalled();
            choose(); deliver();
            for (let i = 0; i < 5; i++) await flushPromises();
            expect(importFile).toHaveBeenCalledTimes(1);
            expect(importFile.mock.calls[0][1]?.acquisition).toBe('original_file');
            expect(getButtonsByText(context.containerEl, 'Add original from Files')).toHaveLength(0);
        } finally {
            sourceOpen.mockRestore(); Object.assign(Platform, { isMobileApp: wasMobile });
            await context.view.onClose(); await service.dispose();
        }
    });

    it('limits image management to imported files still in chat directories', async () => {
        const context = createView();
        const { service } = attachDisclosureService(context, new MemoryChatHistoryStore());
        const asset = { id: 'chat', originalPath: 'assets/pa-images/chat.jpg', importDirectory: 'assets/pa-images',
            source: 'imported', byteLength: 3, state: 'available', owners: [],
            originalHash: 'a'.repeat(64), detectedMime: 'image/jpeg', acquisition: 'original_file',
            anchorPath: 'PA Chat.md', anchorKind: 'logical_root', createdAt: 1 };
        jest.spyOn(service, 'listAssets').mockResolvedValue([
            asset,
            { ...asset, id: 'promoted', source: 'vault_reference', originalPath: 'assets/promoted.jpg' },
            { ...asset, id: 'external-move', originalPath: 'assets/relocated.jpg' },
            { ...asset, id: 'vault-reference', source: 'vault_reference', originalPath: 'assets/pa-images/referenced.jpg' },
        ] as Awaited<ReturnType<ImageAssetService['listAssets']>>);
        const modal = new ImageManagementModal(context.app as unknown as App, service);
        const root = new MockElement('div');
        modal.contentEl = root as unknown as HTMLElement;
        try {
            modal.onOpen(); await flushPromises();
            const rows = walkAll(root, (element) => element.classList.contains('pa-chat-image-management__item'));
            expect(rows).toHaveLength(1);
            expect(allText(rows[0])).toContain('assets/pa-images/chat.jpg');
            expect(allText(root)).not.toContain('assets/promoted.jpg');
            expect(allText(root)).not.toContain('assets/relocated.jpg');
            expect(allText(root)).not.toContain('assets/pa-images/referenced.jpg');
        } finally { modal.onClose(); await service.dispose(); }
    });

    it('makes provider disclosure readable again even when the image registry fails', async () => {
        const listAssets = jest.fn(async () => { throw new Error('storage unavailable'); });
        const images = { listAssets } as unknown as ImageAssetService;
        for (let attempt = 0; attempt < 2; attempt++) {
            const root = new MockElement('div'), modal = new ImageManagementModal({} as App, images);
            modal.contentEl = root as unknown as HTMLElement; modal.onOpen();
            await flushPromises();
            const help = walkAll(root, (element) => element.tagName === 'details')[0];
            expect(walk(help, (element) => element.tagName === 'summary')?.textContent).toBe('Images and your AI provider');
            const paragraphs = walkAll(help, (element) => element.tagName === 'p').map((element) => element.textContent).join('\n');
            expect(paragraphs).toContain('AI provider receives');
            expect(paragraphs).toContain('Convert HEIC to JPEG before adding it to PA');
            expect(walk(root, (element) => element.getAttribute('role') === 'status')?.textContent).toBeTruthy();
            modal.onClose();
        }
        expect(listAssets).toHaveBeenCalledTimes(2);
    });

    it.each([false, true])('discloses before old-history image reuse, without late notices or sends after close: %s', async (closeBeforeRead) => {
        const context = createView(), store = new MemoryChatHistoryStore();
        const { service, ref } = attachDisclosureService(context, store);
        const notices = (Notice as unknown as { messages: Array<{ message: unknown }> }).messages;
        const initial = notices.length;
        let finishRead!: (value: null) => void;
        const read = new Promise<null>((resolve) => { finishRead = resolve; });
        jest.spyOn(store, 'getImageSetting').mockImplementationOnce(() => read);
        await context.view.onOpen();
        context.view.chatHistory = [{ role: 'user', content: 'Earlier image', images: [{ ref, ordinal: 1, label: 'prior.png' }] },
            { role: 'assistant', content: 'Earlier answer' }];
        context.view.prefillComposer('Look at that image again');
        getButtonByText(context.containerEl, 'Ask').click();
        await flushPromises();
        expect(mockStreamLLM).not.toHaveBeenCalled();
        if (closeBeforeRead) await context.view.onClose();
        finishRead(null);
        for (let i = 0; i < 4; i++) await flushPromises();
        const observed = notices.slice(initial).filter((item) => String(item.message).includes('AI provider receives'));
        expect(observed).toHaveLength(closeBeforeRead ? 0 : 1);
        if (closeBeforeRead) {
            expect(mockStreamLLM).not.toHaveBeenCalled();
            expect(await store.getImageSetting('provider-notice:v1')).toBeNull();
        } else {
            expect(mockStreamLLM).toHaveBeenCalledTimes(1);
            expect(streamCalls[0].chatHistory?.[0]).toMatchObject({ images: [{ ref }] });
            expect(await store.getImageSetting('provider-notice:v1')).toBe(true);
            streamCalls[0].resolve();
            await flushPromises();
            await context.view.onClose();
        }
        await service.dispose();
    });

    it('does not block an existing-image conversation text request when disclosure storage initialization fails', async () => {
        const context = createView(), store = new MemoryChatHistoryStore();
        const { service, ref } = attachDisclosureService(context, store);
        const notices = (Notice as unknown as { messages: Array<{ message: unknown }> }).messages;
        const initial = notices.length;
        jest.spyOn(store, 'initialize').mockRejectedValue(new Error('storage unavailable'));
        const persist = jest.spyOn(store, 'setImageSetting');
        await context.view.onOpen();
        context.view.chatHistory = [{ role: 'user', content: 'Prior image', images: [{ ref, ordinal: 1, label: 'prior.png' }] },
            { role: 'assistant', content: 'Prior answer' }];
        context.view.prefillComposer('Summarize the earlier answer in one sentence');
        getButtonByText(context.containerEl, 'Ask').click();
        for (let i = 0; i < 4; i++) await flushPromises();
        expect(notices.slice(initial).filter((item) => String(item.message).includes('AI provider receives'))).toHaveLength(1);
        expect(persist).not.toHaveBeenCalled();
        expect(mockStreamLLM).toHaveBeenCalledTimes(1);
        expect(streamCalls[0].prompt).toBe('Summarize the earlier answer in one sentence');
        streamCalls[0].resolve(); await flushPromises();
        await context.view.onClose(); await service.dispose();
    });

    it('records a Pagelet image anchor even when the first turn has no images', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'anchored-conversation' });
        const { view, containerEl } = createView({ chatHistoryManager: manager });
        await view.onOpen();
        const handoff = createPageletHandoffContext();
        expect((await view.preparePageletHandoff(handoff)).status).toBe('prepared');
        getElementByClass(containerEl, 'send-button-visible').click();
        await flushPromises();
        streamCalls[0].onChunk('Answer about this note');
        streamCalls[0].resolve();
        for (let i = 0; i < 6; i++) await flushPromises();
        expect((await store.getConversation('anchored-conversation'))?.imageAnchor).toEqual({ path: handoff.anchor.path, kind: 'existing_note' });
        view.prefillComposer('continue');
        getElementByClass(containerEl, 'send-button-visible').click();
        await flushPromises();
        streamCalls[1].onChunk('Another answer');
        streamCalls[1].resolve();
        for (let i = 0; i < 6; i++) await flushPromises();
        expect((await store.getConversation('anchored-conversation'))?.imageAnchor).toEqual({ path: handoff.anchor.path, kind: 'existing_note' });
    });

    it.each([false, true])('offers direct original deletion only on Desktop: %s', async (desktop) => {
        const descriptor = Object.getOwnPropertyDescriptor(Platform, 'isDesktopApp');
        Object.defineProperty(Platform, 'isDesktopApp', { configurable: true, value: desktop });
        try {
            const clearCache = jest.fn(async () => undefined);
            const cleanupSelected = jest.fn();
            const images = { listAssets: async () => [{ source: 'imported', state: 'available', owners: [],
                originalPath: 'attachments/pa-images/synthetic.png', importDirectory: 'attachments/pa-images', byteLength: 200, id: 'asset' }],
                clearCache, cleanupSelected } as unknown as ImageAssetService;
            const modal = new ImageManagementModal({} as never, images);
            const root = new MockElement('div');
            modal.contentEl = root as unknown as HTMLElement;
            modal.onOpen();
            await flushPromises();
            expect(getButtonsByClass(root, 'mod-warning')).toHaveLength(desktop ? 1 : 0);
            expect(walkAll(root, (element) => element.getAttribute('type') === 'checkbox')).toHaveLength(desktop ? 1 : 0);
            walkAll(root, (element) => element.tagName === 'button')[1].click();
            await flushPromises();
            expect(clearCache).toHaveBeenCalledTimes(1);
            expect(cleanupSelected).not.toHaveBeenCalled();
            modal.onClose();
        } finally {
            if (descriptor) Object.defineProperty(Platform, 'isDesktopApp', descriptor);
            else Reflect.deleteProperty(Platform, 'isDesktopApp');
        }
    });

    it('does not clear a newly started image import when startup history finishes late', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'old-conversation' });
        await manager.initialize();
        await manager.startConversation('older conversation');
        let finishRead!: (turns: Awaited<ReturnType<ChatHistoryManager['getTurns']>>) => void;
        jest.spyOn(manager, 'getTurns').mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
        const { view } = createView({ chatHistoryManager: manager });
        await view.onOpen();
        await flushPromises();
        const draft = (view as unknown as { composerDraft: ComposerDraft<MessageImage> }).composerDraft;
        const handle = draft.beginImport('new-photo.jpg');
        finishRead([]);
        await flushPromises();
        expect(draft.hasDraft('')).toBe(true);
        expect(handle.signal.aborted).toBe(false);
        await view.onClose();
    });

    it('consumes only its unchanged auto-restored draft when retrying a failed turn', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();
        const editor = getTextArea(containerEl);
        // Native textarea.value assignment does not emit an input event. The
        // legacy mock setter does, so use native semantics for ownership here.
        Object.defineProperty(editor, 'value', { configurable: true, writable: true, value: '' });
        view.prefillComposer('first prompt');
        getElementByClass(containerEl, 'send-button-visible').click();
        await flushPromises();
        streamCalls[0].reject(new Error('offline'));
        await flushPromises();
        expect(editor.value).toBe('first prompt');
        getElementByClass(containerEl, 'retry-message-button').click();
        await flushPromises();
        expect(editor.value).toBe('');
        expect(streamCalls[1].prompt).toBe('first prompt');
        streamCalls[1].resolve();
        await flushPromises();
    });

    it('sends image-only selections as references and keeps the next draft on failure', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();
        const draft = (view as unknown as { composerDraft: ComposerDraft<MessageImage> }).composerDraft;
        const handle = draft.beginImport('photo.jpg');
        const image = { ref: { assetId: 'asset-1', contentHash: 'a'.repeat(64) }, label: 'photo.jpg', ordinal: 1 };
        draft.completeImport(handle, image);
        // Input refresh uses the production canSend predicate, including image-only content.
        getTextArea(containerEl).dispatchEvent('input');
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        expect(streamCalls[0].prompt).toBe('');
        expect(streamCalls[0].options.images).toEqual([image]);
        getTextArea(containerEl).value = 'next draft';
        getTextArea(containerEl).dispatchEvent('input');
        streamCalls[0].reject(new Error('offline'));
        await flushPromises();
        expect(getTextArea(containerEl).value).toBe('next draft');
        expect(draft.snapshot('next draft').images).toEqual([]);
        expect(getButtonsByClass(containerEl, 'retry-message-button')).toHaveLength(1);
    });

    it('prepares a complete removable Pagelet attachment without sending and consumes it after one successful Ask', async () => {
        const { view, containerEl } = createView({ operationsEnabled: true });
        await view.onOpen();
        const context = createPageletHandoffContext();

        await expect(view.preparePageletHandoff(context)).resolves.toEqual({ status: 'prepared' });
        expect(mockResetChatContext).toHaveBeenCalledTimes(1);

        const attachment = getElementByClass(containerEl, 'pa-chat-pagelet-attachment');
        expect(attachment.hidden).toBe(false);
        expect(allText(attachment)).toContain(context.body);
        expect(allText(attachment)).toContain('Source A — research/a.md');
        expect(allText(attachment)).toContain('Source B — research/b.md');
        expect(allText(attachment)).toContain('https://example.com/a');
        expect(allText(attachment)).toContain('https://example.com/b');
        expect(getTextArea(containerEl).value).toBe('Discuss this Pagelet insight and help me decide the next step.');
        expect(streamCalls).toHaveLength(0);

        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        expect(streamCalls).toHaveLength(1);
        expect(streamCalls[0].options.pageletHandoff).toEqual(context);
        expect(streamCalls[0].prompt).toBe('Discuss this Pagelet insight and help me decide the next step.');
        streamCalls[0].onChunk('A source-backed answer.');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(attachment.hidden).toBe(true);
        getTextArea(containerEl).value = 'A follow-up question';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        expect(streamCalls[1].options.pageletHandoff).toBeUndefined();
        streamCalls[1].resolve();
        await flushPromises();
    });

    it('fails closed for a draft or active stream and retains Pagelet evidence after provider failure', async () => {
        const chatHistoryManager = createWritableChatHistoryManager();
        const { view, containerEl } = createView({
            chatHistoryManager,
        });
        await view.onOpen();
        const context = createPageletHandoffContext();
        const textArea = getTextArea(containerEl);

        textArea.value = 'Do not replace this draft';
        await expect(view.preparePageletHandoff(context)).resolves.toEqual({ status: 'draft-conflict' });
        expect(textArea.value).toBe('Do not replace this draft');
        expect(getElementByClass(containerEl, 'pa-chat-pagelet-attachment').hidden).toBe(true);

        textArea.value = 'Normal question';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        await expect(view.preparePageletHandoff(context)).resolves.toEqual({ status: 'busy' });
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();
        expect(chatHistoryManager.recordTurn).toHaveBeenCalledTimes(1);

        textArea.value = '';
        await expect(view.preparePageletHandoff(context)).resolves.toEqual({ status: 'prepared' });
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[1].reject(new Error('provider unavailable'));
        await flushPromises();
        await flushPromises();

        const attachment = getElementByClass(containerEl, 'pa-chat-pagelet-attachment');
        expect(attachment.hidden).toBe(false);
        expect(allText(attachment)).toContain(context.body);
    });

    it('clears a prepared Pagelet attachment when the user starts New Chat', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();
        await expect(view.preparePageletHandoff(createPageletHandoffContext())).resolves.toEqual({ status: 'prepared' });

        void getButtonByText(containerEl, 'New Chat').click();
        await flushPromises();
        await flushPromises();

        expect(getElementByClass(containerEl, 'pa-chat-pagelet-attachment').hidden).toBe(true);
        expect(getTextArea(containerEl).value).toBe('');
    });

    it('keeps the current conversation intact when chat history is unavailable', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();
        const textArea = getTextArea(containerEl);
        textArea.value = 'Keep this conversation';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('This answer is only visible locally.');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();
        const existingHistory = [...view.chatHistory];
        mockCancelPendingOperations.mockClear();

        await expect(view.preparePageletHandoff(createPageletHandoffContext())).resolves.toEqual({
            status: 'unavailable',
        });

        expect(view.chatHistory).toEqual(existingHistory);
        expect(allText(containerEl)).toContain('Keep this conversation');
        expect(allText(containerEl)).toContain('This answer is only visible locally.');
        expect(textArea.value).toBe('');
        expect(getElementByClass(containerEl, 'pa-chat-pagelet-attachment').hidden).toBe(true);
        expect(mockCancelPendingOperations).not.toHaveBeenCalled();
        expect(mockResetChatContext).not.toHaveBeenCalled();
    });

    it('keeps the current conversation intact when recording its visible turn failed', async () => {
        const chatHistoryManager = createWritableChatHistoryManager({
            recordTurnError: new Error('record failed'),
        });
        const { view, containerEl } = createView({ chatHistoryManager });
        await view.onOpen();
        const textArea = getTextArea(containerEl);
        textArea.value = 'Keep the failed record';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('Still visible after the record failure.');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();
        expect(chatHistoryManager.recordTurn).toHaveBeenCalledTimes(1);
        const existingHistory = [...view.chatHistory];
        mockCancelPendingOperations.mockClear();

        await expect(view.preparePageletHandoff(createPageletHandoffContext())).resolves.toEqual({
            status: 'unavailable',
        });

        expect(view.chatHistory).toEqual(existingHistory);
        expect(allText(containerEl)).toContain('Keep the failed record');
        expect(allText(containerEl)).toContain('Still visible after the record failure.');
        expect(chatHistoryManager.setActiveConversationId).not.toHaveBeenCalled();
        expect(mockCancelPendingOperations).not.toHaveBeenCalled();
    });

    it('does not clear the UI or pending Operations when the active pointer cannot be cleared', async () => {
        const chatHistoryManager = createWritableChatHistoryManager({
            clearPointerError: new Error('pointer failed'),
        });
        const { view, containerEl } = createView({ chatHistoryManager });
        await view.onOpen();
        const textArea = getTextArea(containerEl);
        textArea.value = 'Persisted current conversation';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('Persisted current answer.');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();
        expect(chatHistoryManager.recordTurn).toHaveBeenCalledTimes(1);
        const existingHistory = [...view.chatHistory];
        mockCancelPendingOperations.mockClear();

        await expect(view.preparePageletHandoff(createPageletHandoffContext())).resolves.toEqual({
            status: 'unavailable',
        });

        expect(chatHistoryManager.setActiveConversationId).toHaveBeenCalledWith(null);
        expect(view.chatHistory).toEqual(existingHistory);
        expect(allText(containerEl)).toContain('Persisted current conversation');
        expect(allText(containerEl)).toContain('Persisted current answer.');
        expect(textArea.value).toBe('');
        expect(getElementByClass(containerEl, 'pa-chat-pagelet-attachment').hidden).toBe(true);
        expect(mockCancelPendingOperations).not.toHaveBeenCalled();
    });

    it('restores the prior pointer and leaves Chat intact when the user starts a stream during a deferred handoff', async () => {
        let releaseClear: (() => void) | undefined;
        let markClearStarted: (() => void) | undefined;
        const clearGate = new Promise<void>((resolve) => {
            releaseClear = resolve;
        });
        const clearStarted = new Promise<void>((resolve) => {
            markClearStarted = resolve;
        });
        const chatHistoryManager = createWritableChatHistoryManager();
        chatHistoryManager.setActiveConversationId.mockImplementation(async (id: string | null) => {
            if (id !== null) return;
            markClearStarted?.();
            await clearGate;
        });
        const { view, containerEl } = createView({ chatHistoryManager });
        await view.onOpen();
        const textArea = getTextArea(containerEl);
        textArea.value = 'Existing prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('Existing answer.');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();
        const existingHistory = [...view.chatHistory];
        mockCancelPendingOperations.mockClear();

        const preparing = view.preparePageletHandoff(createPageletHandoffContext());
        await clearStarted;
        textArea.value = 'User took over while Pagelet was opening';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        expect(streamCalls).toHaveLength(2);
        releaseClear?.();

        await expect(preparing).resolves.toEqual({ status: 'busy' });
        expect(chatHistoryManager.setActiveConversationId.mock.calls).toEqual([
            [null],
            ['conv_pagelet_handoff'],
        ]);
        expect(view.chatHistory).toEqual(existingHistory);
        expect(getElementByClass(containerEl, 'pa-chat-pagelet-attachment').hidden).toBe(true);
        expect(allText(containerEl)).toContain('User took over while Pagelet was opening');
        expect(mockCancelPendingOperations).not.toHaveBeenCalled();

        streamCalls[1].resolve();
        await flushPromises();
        await flushPromises();
    });

    it('cancels a deferred handoff without resetting Chat when its Panel signal aborts', async () => {
        let releaseClear: (() => void) | undefined;
        let markClearStarted: (() => void) | undefined;
        const clearGate = new Promise<void>((resolve) => {
            releaseClear = resolve;
        });
        const clearStarted = new Promise<void>((resolve) => {
            markClearStarted = resolve;
        });
        const chatHistoryManager = createWritableChatHistoryManager();
        chatHistoryManager.setActiveConversationId.mockImplementation(async (id: string | null) => {
            if (id !== null) return;
            markClearStarted?.();
            await clearGate;
        });
        const { view, containerEl } = createView({ chatHistoryManager });
        await view.onOpen();
        const textArea = getTextArea(containerEl);
        textArea.value = 'Conversation before Panel close';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('Answer before Panel close.');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();
        const existingHistory = [...view.chatHistory];
        mockCancelPendingOperations.mockClear();
        const controller = new AbortController();

        const preparing = view.preparePageletHandoff(
            createPageletHandoffContext(),
            controller.signal,
        );
        await clearStarted;
        controller.abort();
        releaseClear?.();

        await expect(preparing).resolves.toEqual({ status: 'unavailable' });
        expect(chatHistoryManager.setActiveConversationId.mock.calls).toEqual([
            [null],
            ['conv_pagelet_handoff'],
        ]);
        expect(view.chatHistory).toEqual(existingHistory);
        expect(textArea.value).toBe('');
        expect(getElementByClass(containerEl, 'pa-chat-pagelet-attachment').hidden).toBe(true);
        expect(mockCancelPendingOperations).not.toHaveBeenCalled();
    });

    it('serializes concurrent Pagelet handoff preparation requests', async () => {
        let releaseClear: (() => void) | undefined;
        let markClearStarted: (() => void) | undefined;
        const clearGate = new Promise<void>((resolve) => {
            releaseClear = resolve;
        });
        const clearStarted = new Promise<void>((resolve) => {
            markClearStarted = resolve;
        });
        const chatHistoryManager = createWritableChatHistoryManager();
        chatHistoryManager.setActiveConversationId.mockImplementation(async (id: string | null) => {
            if (id !== null) return;
            markClearStarted?.();
            await clearGate;
        });
        const { view, containerEl } = createView({ chatHistoryManager });
        await view.onOpen();
        const textArea = getTextArea(containerEl);
        textArea.value = 'Persist me first';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('Persisted answer.');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const firstContext = createPageletHandoffContext();
        const secondContext = { ...firstContext, id: 'pagelet-cache-2' };
        const first = view.preparePageletHandoff(firstContext);
        await clearStarted;
        const second = view.preparePageletHandoff(secondContext);
        await flushPromises();
        expect(chatHistoryManager.setActiveConversationId).toHaveBeenCalledTimes(1);
        releaseClear?.();

        await expect(first).resolves.toEqual({ status: 'prepared' });
        await expect(second).resolves.toEqual({ status: 'draft-conflict' });
        expect(chatHistoryManager.setActiveConversationId).toHaveBeenCalledTimes(1);
        expect(allText(getElementByClass(containerEl, 'pa-chat-pagelet-attachment'))).toContain(firstContext.body);
    });

    it('explains a typed early context overflow before any lifecycle event exists', async () => {
        const chatHistoryManager = createWritableChatHistoryManager();
        const { view, containerEl } = createView({ chatHistoryManager });
        await view.onOpen();
        getTextArea(containerEl).value = 'oversized current input';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].reject(new PaAgentContextOverflowError(120_001, 120_000));
        await flushPromises();
        await flushPromises();

        expect(allText(containerEl)).toContain('The current context is too long to continue.');
        expect(allText(containerEl)).not.toContain('PaAgentContextOverflowError');
        expect(allText(containerEl)).not.toContain('exceeds the local context budget');
        expect(view.chatHistory).toHaveLength(0);
        expect(streamCalls).toHaveLength(1);
        expect(chatHistoryManager.startConversation).not.toHaveBeenCalled();
    });

    it.each([
        ['completed', true],
        ['completed_with_warning', false],
        ['incomplete', false],
    ] as const)('consumes Pagelet evidence only for canonical %s', async (status, shouldConsume) => {
        const { view, containerEl } = createView();
        await view.onOpen();
        await expect(view.preparePageletHandoff(createPageletHandoffContext())).resolves.toEqual({
            status: 'prepared',
        });

        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('Canonical response.');
        emitCanonical(streamCalls[0], canonicalEvent({ type: 'agent_start' }));
        emitCanonical(streamCalls[0], canonicalEvent({ type: 'agent_end', status }));
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementByClass(containerEl, 'pa-chat-pagelet-attachment').hidden).toBe(shouldConsume);
    });

    it('retains Pagelet evidence after a legacy partial-output failure', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();
        await expect(view.preparePageletHandoff(createPageletHandoffContext())).resolves.toEqual({
            status: 'prepared',
        });

        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('Partial response.');
        streamCalls[0].options.onEvent?.({
            version: 1,
            turnId: 'legacy_turn_1',
            seq: 1,
            timestamp: 100,
            kind: 'partial-output-error',
            category: 'provider',
        });
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(getElementByClass(containerEl, 'pa-chat-pagelet-attachment').hidden).toBe(false);
        expect(view.chatHistory[1].shareCardEligible).toBe(false);
        expect(getButtonsByClass(containerEl, 'share-card-message-button')).toHaveLength(0);
    });

    it('keeps an Operations preview inline and inert until the model turn finishes, then supports confirm and Undo', async () => {
        const { view, containerEl } = createView({ operationsEnabled: true });
        await view.onOpen();
        const operation: PreparedOperation = {
            id: 'operation_1',
            toolCallId: 'call_1',
            name: 'vault_create',
            input: {
                path: '0.unsorted/decision.md',
                content: '# Decision\n\nKeep the quiet default.',
            },
            path: '0.unsorted/decision.md',
            expectedBefore: null,
            expectedAfter: '# Decision\n\nKeep the quiet default.',
        };
        const intent: OperationsIntent = {
            id: 'intent_1',
            runId: 'run_1',
            turnId: 'turn_1',
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            operations: [operation],
            state: 'pending',
        };
        mockCancelOperationsIntent.mockReturnValue({ ...intent, state: 'cancelled' });
        mockConfirmOperationsIntent.mockResolvedValue({
            intentId: intent.id,
            state: 'completed',
            operations: [{
                operationId: operation.id,
                toolCallId: operation.toolCallId,
                name: operation.name,
                path: operation.path,
                status: 'succeeded',
                receiptId: 'receipt_1',
                auditStatus: 'written',
                auditRetentionWarning: 'cleanup unavailable',
            }],
        });
        mockUndoOperations.mockResolvedValue([{
            receiptId: 'receipt_1',
            operationId: operation.id,
            path: operation.path,
            status: 'undone',
            auditStatus: 'written',
            auditRetentionWarning: 'cleanup unavailable',
        }]);

        getTextArea(containerEl).value = 'Save this decision';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        const call = streamCalls[0];
        call.options.onOperationsIntentStaged?.(intent);

        const card = getElementByClass(containerEl, 'pa-operations-intent-card');
        const confirmButton = getButtonByText(card, 'Confirm changes');
        expect(confirmButton.disabled).toBe(true);
        expect(mockConfirmOperationsIntent).not.toHaveBeenCalled();
        expect(allText(card)).toContain('0.unsorted/decision.md');
        expect(allText(card)).toContain('Keep the quiet default.');

        call.resolve();
        await flushPromises();
        await flushPromises();
        runAnimationFrames(true);

        expect(allText(containerEl)).toContain('The current proposal is ready for review below. Nothing has been written yet.');
        expect(confirmButton.disabled).toBe(false);
        await confirmButton.click();
        await flushPromises();
        expect(mockConfirmOperationsIntent).toHaveBeenCalledWith(intent.id);
        expect(allText(card)).toContain('Changes applied.');
        expect(allText(card)).toContain('older audit files may not have been cleaned up');

        const undoButton = getButtonByText(card, 'Undo');
        expect(undoButton.hidden).toBe(false);
        await undoButton.click();
        await flushPromises();
        expect(mockUndoOperations).toHaveBeenCalledWith(['receipt_1']);
        expect(allText(card)).toContain('Undone; older audit files may not have been cleaned up');
    });

    it('submits one visible save request from a qualifying vault-backed conclusion', async () => {
        const { view, containerEl } = createView({ operationsEnabled: true });
        await view.onOpen();

        getTextArea(containerEl).value = 'Summarize the decision from these notes';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: false,
            allowedMemorySourcePaths: [],
            contextUsed: [{
                category: 'current-note',
                label: 'Current note',
                sources: [{ path: 'notes/decision.md' }],
            }],
        });
        streamCalls[0].onChunk('# Decision\n\n' + 'A source-backed conclusion with a clear next step. '.repeat(12));
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const suggestion = getElementByClass(containerEl, 'pa-operations-save-suggestion');
        expect(allText(suggestion)).toContain('worth keeping');
        jest.useFakeTimers();
        getButtonByText(suggestion, 'Save').click();
        jest.runOnlyPendingTimers();
        await Promise.resolve();
        jest.useRealTimers();
        await flushPromises();

        expect(streamCalls).toHaveLength(2);
        expect(streamCalls[1].prompt).toContain('Save the conclusion from your previous answer');
        expect(getElementsByClass(containerEl, 'pa-operations-save-suggestion')).toHaveLength(1);
        streamCalls[1].resolve();
        await flushPromises();
    });

    it('keeps a save suggestion retryable when a draft blocks dispatch', async () => {
        const { view, containerEl } = createView({ operationsEnabled: true });
        await view.onOpen();

        getTextArea(containerEl).value = 'Summarize this plan';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: false,
            allowedMemorySourcePaths: [],
            contextUsed: [{ category: 'current-note', label: 'Current note' }],
        });
        streamCalls[0].onChunk('## Plan\n\n- ' + 'A complete, source-backed plan with a settled decision. '.repeat(12));
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const textArea = getTextArea(containerEl);
        textArea.value = 'my next question';
        const suggestion = getElementByClass(containerEl, 'pa-operations-save-suggestion');
        const saveButton = getButtonByText(suggestion, 'Save');
        jest.useFakeTimers();
        saveButton.click();
        jest.runOnlyPendingTimers();
        await Promise.resolve();
        jest.useRealTimers();
        await flushPromises();

        expect(textArea.value).toBe('my next question');
        expect(streamCalls).toHaveLength(1);
        expect(saveButton.hidden).toBe(false);
        expect(saveButton.disabled).toBe(false);
        expect(allText(suggestion)).toContain('Send your current draft first');

        textArea.value = '';
        jest.useFakeTimers();
        saveButton.click();
        jest.runOnlyPendingTimers();
        await Promise.resolve();
        jest.useRealTimers();
        await flushPromises();

        expect(streamCalls).toHaveLength(2);
        expect(streamCalls[1].prompt).toContain('Save the conclusion from your previous answer');
        expect(saveButton.hidden).toBe(true);
        streamCalls[1].resolve();
        await flushPromises();
    });

    it.each(['Clear Chat', 'New Chat'] as const)(
        '%s discards pending Operations intents before resetting the conversation',
        async (actionLabel) => {
            const { view, containerEl } = createView({ operationsEnabled: true });
            await view.onOpen();
            mockCancelOperationsIntent.mockClear();
            mockCancelPendingOperations.mockClear();

            const operation: PreparedOperation = {
                id: `operation_${actionLabel}`,
                toolCallId: `call_${actionLabel}`,
                name: 'vault_append',
                input: { path: 'notes/decision.md', content: '\nKeep this.' },
                path: 'notes/decision.md',
                expectedBefore: '# Decision',
                expectedAfter: '# Decision\nKeep this.',
            };
            const intent: OperationsIntent = {
                id: `intent_${actionLabel}`,
                runId: 'run_reset',
                turnId: 'turn_reset',
                createdAt: Date.now(),
                expiresAt: Date.now() + 60_000,
                operations: [operation],
                state: 'pending',
            };

            getTextArea(containerEl).value = 'Prepare a note update';
            void getButtonByText(containerEl, 'Ask').click();
            await flushPromises();
            streamCalls[0].options.onOperationsIntentStaged?.(intent);
            streamCalls[0].onChunk('Review this proposed change.');
            streamCalls[0].resolve();
            await flushPromises();
            await flushPromises();

            const card = getElementByClass(containerEl, 'pa-operations-intent-card');
            const confirmButton = getButtonByText(card, 'Confirm changes');
            let releasePendingWrites!: () => void;
            const pendingWrites = new Promise<void>((resolve) => {
                releasePendingWrites = resolve;
            });
            const persistence = (view as unknown as {
                conversationPersistence: { waitForPendingWrites: () => Promise<void> };
            }).conversationPersistence;
            const waitForPendingWrites = jest.spyOn(persistence, 'waitForPendingWrites')
                .mockReturnValueOnce(pendingWrites);
            mockCancelOperationsIntent.mockClear();
            mockCancelPendingOperations.mockClear();
            mockConfirmOperationsIntent.mockClear();
            getButtonByText(containerEl, actionLabel).click();
            await Promise.resolve();

            expect(waitForPendingWrites).toHaveBeenCalledTimes(1);
            expect(mockCancelOperationsIntent).toHaveBeenCalledWith(intent.id);
            expect(mockCancelPendingOperations).toHaveBeenCalledTimes(1);
            expect(confirmButton.disabled).toBe(true);
            expect(confirmButton.hidden).toBe(true);
            confirmButton.click();
            expect(mockConfirmOperationsIntent).not.toHaveBeenCalled();
            expect(getElementsByClass(containerEl, 'pa-operations-intent-card')).toHaveLength(1);

            releasePendingWrites();
            await flushPromises();
            await flushPromises();
            expect(getElementsByClass(containerEl, 'pa-operations-intent-card')).toHaveLength(0);
            expect(mockResetChatContext).toHaveBeenCalledTimes(1);
        },
    );

    it('formats bounded operation-specific previews without HTML injection', () => {
        const operation = {
            id: 'operation_preview',
            toolCallId: 'call_preview',
            name: 'frontmatter_update',
            input: {
                path: 'notes/project.md',
                set: { status: '<script>alert(1)</script>' },
                delete: ['legacy'],
            },
            path: 'notes/project.md',
            expectedBefore: '---\nlegacy: true\n---\nBody',
            expectedAfter: '---\nstatus: value\n---\nBody',
        } satisfies PreparedOperation;

        expect(formatOperationsPreview(operation)).toBe([
            'Set status: "<script>alert(1)</script>"',
            'Remove legacy',
        ].join('\n'));
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
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
        expect(mockResetChatContext).toHaveBeenCalledTimes(1);
        expect(mockDisposeChatService).toHaveBeenCalledTimes(1);

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

    it('keeps auto-scroll enabled for layout-only scroll events', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'write while layout changes';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        runAnimationFrames(true);

        const responseDiv = getResponseDiv(view);
        responseDiv.scrollHeight = 1000;
        responseDiv.clientHeight = 300;
        responseDiv.scrollTop = 0;
        responseDiv.dispatchEvent('scroll');
        const scrollCallCountBeforeStatus = responseDiv.scrollToCalls.length;

        streamCalls[0].options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);
        runAnimationFrames();

        expect(responseDiv.scrollToCalls.slice(scrollCallCountBeforeStatus)).toContainEqual({
            top: 700,
            behavior: 'smooth',
        });
    });

    it('pauses auto-scroll after explicit touch scrolling', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'write while user scrolls';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        runAnimationFrames(true);

        const responseDiv = getResponseDiv(view);
        responseDiv.scrollHeight = 1000;
        responseDiv.clientHeight = 300;
        responseDiv.scrollTop = 0;
        responseDiv.dispatchEvent('touchstart');
        responseDiv.dispatchEvent('scroll');
        const scrollCallCountBeforeStatus = responseDiv.scrollToCalls.length;

        streamCalls[0].options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);
        runAnimationFrames();

        expect(responseDiv.scrollToCalls).toHaveLength(scrollCallCountBeforeStatus);
        await view.onClose();
    });

    it('pauses auto-scroll after keyboard scrolling', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'write while keyboard scrolls';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        runAnimationFrames(true);

        const responseDiv = getResponseDiv(view);
        responseDiv.scrollHeight = 1000;
        responseDiv.clientHeight = 300;
        responseDiv.scrollTop = 0;
        responseDiv.dispatchEvent('keydown', { key: 'PageUp' });
        responseDiv.dispatchEvent('scroll');
        const scrollCallCountBeforeStatus = responseDiv.scrollToCalls.length;

        streamCalls[0].options.onStatus?.({ type: 'thinking' } as ChatAgentStatus);
        runAnimationFrames();

        expect(responseDiv.scrollToCalls).toHaveLength(scrollCallCountBeforeStatus);
        await view.onClose();
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

        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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

        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
            { role: 'user', content: 'summarize this note' },
            { role: 'assistant', content: 'summary answer' },
        ]);
        expect(allText(containerEl)).toContain('summarize this note');
        expect(allText(containerEl)).toContain('summary answer');
        expect(view.chatHistory[0].hostProvenance).toMatchObject({ version: 1, kind: 'ordinary_user_statement' });
        expect(view.chatHistory[1].hostProvenance).toMatchObject({ version: 1, kind: 'ai_draft' });
        expect(view.chatHistory[0].hostProvenance?.messageId).not.toBe(view.chatHistory[1].hostProvenance?.messageId);

        getTextArea(containerEl).value = 'follow up';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        expect(streamCalls).toHaveLength(2);
        expect(streamCalls[1].chatHistory).toMatchObject([
            { role: 'user', content: 'summarize this note' },
            { role: 'assistant', content: 'summary answer' },
        ]);
        expect(streamCalls[1].chatHistory).not.toBe(view.chatHistory);
        expect(streamCalls[1].chatHistory?.[0]).not.toBe(view.chatHistory[0]);
        expect(streamCalls[1].chatHistory?.[1]).not.toBe(view.chatHistory[1]);
    });

    it('offers Share Card only for a completed assistant message and uses its latest content and source path', async () => {
        const { view, containerEl, app } = createView({ withMarkdownLeaf: true });
        await view.onOpen();

        getTextArea(containerEl).value = 'share this answer';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        expect(getButtonsByClass(containerEl, 'share-card-message-button')).toHaveLength(0);
        streamCalls[0].onChunk('first part');
        streamCalls[0].onChunk('first part\n\nlatest part');
        await flushPromises();
        expect(getButtonsByClass(containerEl, 'share-card-message-button')).toHaveLength(0);

        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const shareButtons = getButtonsByClass(containerEl, 'share-card-message-button');
        expect(shareButtons).toHaveLength(1);
        expect(getButtonsByClass(getElementByClass(containerEl, 'user'), 'share-card-message-button'))
            .toHaveLength(0);
        shareButtons[0].click();

        expect(mockShareCardModalConstructor).toHaveBeenCalledWith(app, {
            content: 'first part\n\nlatest part',
            source: 'chat',
            sourceLabel: 'PA Chat',
            resourceContext: { basePath: '0.unsorted/Dog.md' },
        });
        expect(mockShareCardModalOpen).toHaveBeenCalledTimes(1);
    });

    it('does not offer Share Card for a non-empty canonical incomplete answer', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'share only if complete';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        const call = streamCalls[0];
        emitCanonical(call, canonicalEvent({
            type: 'agent_start',
            runId: 'run_incomplete_share',
            scope: 'run',
            turnId: '__run__',
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_start',
            runId: 'run_incomplete_share',
            turnId: 'turn_incomplete_share',
            scope: 'turn',
        }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            runId: 'run_incomplete_share',
            turnId: 'turn_incomplete_share',
            scope: 'turn',
            message: assistantMessage('assistant_incomplete_share', [{
                type: 'text',
                text: 'Partial but non-empty answer.',
            }]),
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end',
            runId: 'run_incomplete_share',
            turnId: 'turn_incomplete_share',
            scope: 'turn',
            status: 'incomplete',
        }));
        emitCanonical(call, canonicalEvent({
            type: 'agent_end',
            runId: 'run_incomplete_share',
            scope: 'run',
            turnId: '__run__',
            status: 'incomplete',
            metadata: { finalTurnId: 'turn_incomplete_share' },
        }));
        call.resolve();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory[1].content).toBe('Partial but non-empty answer.');
        expect(view.chatHistory[1].shareCardEligible).toBe(false);
        expect(getButtonsByClass(containerEl, 'share-card-message-button')).toHaveLength(0);
    });

    it.each(['aborted', 'error'] as const)(
        'does not offer Share Card for a non-empty canonical %s answer',
        async (status) => {
            const { view, containerEl } = createView();
            await view.onOpen();

            getTextArea(containerEl).value = `share only if not ${status}`;
            void getButtonByText(containerEl, 'Ask').click();
            await flushPromises();
            const call = streamCalls[0];
            emitCanonical(call, canonicalEvent({
                type: 'agent_start',
                runId: `run_${status}_share`,
                scope: 'run',
                turnId: '__run__',
            }));
            emitCanonical(call, canonicalEvent({
                type: 'turn_start',
                runId: `run_${status}_share`,
                turnId: `turn_${status}_share`,
                scope: 'turn',
            }));
            emitCanonical(call, canonicalEvent({
                type: 'message_end',
                runId: `run_${status}_share`,
                turnId: `turn_${status}_share`,
                scope: 'turn',
                message: assistantMessage(`assistant_${status}_share`, [{
                    type: 'text',
                    text: `${status} but non-empty answer.`,
                }]),
            }));
            emitCanonical(call, canonicalEvent({
                type: 'turn_end',
                runId: `run_${status}_share`,
                turnId: `turn_${status}_share`,
                scope: 'turn',
                status,
            }));
            emitCanonical(call, canonicalEvent({
                type: 'agent_end',
                runId: `run_${status}_share`,
                scope: 'run',
                turnId: '__run__',
                status,
                metadata: { finalTurnId: `turn_${status}_share` },
            }));
            call.resolve();
            await flushPromises();
            await flushPromises();

            expect(view.chatHistory[1].content).toBe(`${status} but non-empty answer.`);
            expect(view.chatHistory[1].shareCardEligible).toBe(false);
            expect(getButtonsByClass(containerEl, 'share-card-message-button')).toHaveLength(0);
        },
    );

    it('offers Share Card for a completed-with-warning canonical answer', async () => {
        const { view, containerEl, app } = createView({ withMarkdownLeaf: true });
        await view.onOpen();

        getTextArea(containerEl).value = 'share warning completion';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        const call = streamCalls[0];
        emitCanonical(call, canonicalEvent({ type: 'agent_start' }));
        emitCanonical(call, canonicalEvent({ type: 'turn_start' }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            message: assistantMessage('assistant_warning_share', [{
                type: 'text',
                text: 'Completed answer with a warning.',
            }]),
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end',
            status: 'completed_with_warning',
        }));
        emitCanonical(call, canonicalEvent({
            type: 'agent_end',
            status: 'completed_with_warning',
            metadata: {
                warnings: [{
                    type: 'required_capability_missing',
                    capability: 'webSearch',
                }],
            },
        }));
        call.resolve();
        await flushPromises();
        await flushPromises();

        const shareButton = getButtonsByClass(containerEl, 'share-card-message-button')[0];
        expect(shareButton).toBeDefined();
        shareButton.click();
        expect(mockShareCardModalConstructor).toHaveBeenCalledWith(app, {
            content: 'Completed answer with a warning.',
            source: 'chat',
            sourceLabel: 'PA Chat',
            resourceContext: { basePath: '0.unsorted/Dog.md' },
        });
    });

    it.each([
        'provider_error',
        'assistant_idle_timeout',
        'wall_clock_exceeded',
    ])('does not offer Share Card for partial canonical output with %s', async (warningType) => {
        const { view, containerEl } = createView({ withMarkdownLeaf: true });
        await view.onOpen();

        getTextArea(containerEl).value = 'share interrupted completion';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        const call = streamCalls[0];
        emitCanonical(call, canonicalEvent({ type: 'agent_start' }));
        emitCanonical(call, canonicalEvent({ type: 'turn_start' }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end',
            message: assistantMessage('assistant_partial_share', [{
                type: 'text',
                text: 'Partial answer.',
            }]),
        }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end',
            status: 'completed_with_warning',
            metadata: { diagnostics: [{ type: warningType }] },
        }));
        emitCanonical(call, canonicalEvent({
            type: 'agent_end',
            status: 'completed_with_warning',
        }));
        call.resolve();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory[1].content).toBe('Partial answer.');
        expect(view.chatHistory[1].shareCardEligible).toBe(false);
        expect(getButtonsByClass(containerEl, 'share-card-message-button')).toHaveLength(0);
    });

    it('shows a selected-text hint when the active Markdown editor has a selection', async () => {
        const { view, containerEl, editor } = createView({ withMarkdownLeaf: true });
        (editor as typeof editor & { getSelection: () => string }).getSelection = jest.fn(() => 'selected text');

        await view.onOpen();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const hint = getElementByClass(containerEl, 'pa-chat-selection-hint');
        expect(hint.hidden).toBe(false);
        expect(allText(hint)).toContain('You have text selected');
    });

    it('shows a live assistant placeholder before the first response chunk and reuses it without a side loader', async () => {
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
        expect(getElementsByClass(assistantRole, 'pa-chat-role-loader-assistant')).toHaveLength(0);
        expect(walk(liveAssistantMessages[0], (el) => el.tagName === 'l-bouncy-arc')).toBeNull();
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

        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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
        const loadedOwners = new WeakSet<Component>();
        jest.spyOn(Component.prototype, 'load').mockImplementation(function (this: Component) {
            loadedOwners.add(this);
        });
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
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement, sourcePath?: string, owner?: Component) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement, _sourcePath?: string, owner?: Component) => {
            renderedMarkdown.push(markdown);
            if (markdown.includes('```mermaid') && !markdown.includes('A --> B')) {
                throw new Error('incomplete Mermaid');
            }
            el.setText(markdown);
            if (markdown.includes('```mermaid')) {
                expect(owner).toBeDefined();
                expect(owner ? loadedOwners.has(owner) : false).toBe(true);
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
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
            { role: 'user', content: 'draw a graph' },
            { role: 'assistant', content: '```mermaid\ngraph TD\nA --> B\n```' },
        ]);
        modalOpenSpy.mockRestore();
    });

    it('renders final Mermaid in the attached message DOM with the current note source path', async () => {
        const loadedOwners = new WeakSet<Component>();
        jest.spyOn(Component.prototype, 'load').mockImplementation(function (this: Component) {
            loadedOwners.add(this);
        });
        const finalMermaidRenderCalls: Array<{
            attachedToMessageContent: boolean;
            ownerLoaded: boolean;
            sourcePath: string | undefined;
        }> = [];
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createElement: (tagName: string) => new MockElement(tagName),
            },
        });
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement, sourcePath?: string, owner?: Component) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement, sourcePath?: string, owner?: Component) => {
            el.setText(markdown);
            if (markdown.includes('```mermaid')) {
                finalMermaidRenderCalls.push({
                    attachedToMessageContent: Boolean(el.parentElement?.classList.contains('message-content')),
                    ownerLoaded: owner ? loadedOwners.has(owner) : false,
                    sourcePath,
                });
                el.createDiv({ cls: 'block-language-mermaid' });
            }
        });
        const { view, containerEl, app } = createView({ withMarkdownLeaf: true });
        await view.onOpen();

        const content = '```mermaid\ngraph TD\nA --> B\n```';
        getTextArea(containerEl).value = 'draw a graph';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        app.workspace.getActiveFile.mockReturnValue({ path: '0.unsorted/Cat.md', extension: 'md' });

        streamCalls[0].onChunk(content);
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(finalMermaidRenderCalls).toEqual([
            {
                attachedToMessageContent: true,
                ownerLoaded: true,
                sourcePath: '0.unsorted/Dog.md',
            },
        ]);
        expect(getButtonsByClass(containerEl, 'pa-chat-mermaid-open-button')).toHaveLength(1);
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
            { role: 'user', content: 'draw a graph' },
            { role: 'assistant', content },
        ]);
    });

    it('wraps Mermaid containers that appear after the rendered buffer is attached', async () => {
        const mermaidBuffer: { current: MockElement | null } = { current: null };
        const mutationCallbacks: MutationCallback[] = [];
        const resizeCallbacks: ResizeObserverCallback[] = [];
        class MockMutationObserver {
            readonly observe = jest.fn();
            readonly disconnect = jest.fn();

            constructor(callback: MutationCallback) {
                mutationCallbacks.push(callback);
            }
        }
        class MockResizeObserver {
            readonly observe = jest.fn();
            readonly disconnect = jest.fn();

            constructor(callback: ResizeObserverCallback) {
                resizeCallbacks.push(callback);
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
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: MockResizeObserver,
        });
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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
        const responseDiv = getResponseDiv(view);
        responseDiv.scrollHeight = 1200;
        responseDiv.clientHeight = 320;
        responseDiv.scrollLeft = 64;
        const scrollCallCountBeforeEnhancement = responseDiv.scrollToCalls.length;
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
        expect(responseDiv.scrollLeft).toBe(0);
        runAnimationFrames();
        await flushPromises();
        expect(responseDiv.scrollToCalls.length).toBeGreaterThan(scrollCallCountBeforeEnhancement);
        const enhancementScrollCalls = responseDiv.scrollToCalls.slice(scrollCallCountBeforeEnhancement);
        expect(enhancementScrollCalls).toContainEqual({ top: 880, behavior: 'auto' });
        expect(enhancementScrollCalls).not.toContainEqual({ top: 1200, behavior: 'auto' });
        expect(resizeCallbacks.length).toBeGreaterThan(0);
        responseDiv.scrollHeight = 1600;
        responseDiv.clientHeight = 320;
        const scrollCallCountBeforeResize = responseDiv.scrollToCalls.length;
        resizeCallbacks.forEach((callback) => {
            callback([], {} as ResizeObserver);
        });
        runAnimationFrames();
        await flushPromises();
        expect(responseDiv.scrollToCalls.slice(scrollCallCountBeforeResize)).toContainEqual({
            top: 1280,
            behavior: 'auto',
        });
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
            { role: 'user', content: 'draw two graphs' },
            { role: 'assistant', content: response },
        ]);
    });

    it('does not rerender completed non-Mermaid answers after streaming', async () => {
        const renderedMarkdown: string[] = [];
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
            { role: 'user', content: 'plain answer prompt' },
            { role: 'assistant', content: 'plain answer' },
        ]);
    });

    it('falls back to Mermaid source when final Mermaid rendering throws synchronously', async () => {
        const renderedMarkdown: Array<{ markdown: string; sourcePath: string | undefined }> = [];
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement, sourcePath?: string) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement, sourcePath?: string) => {
            renderedMarkdown.push({ markdown, sourcePath });
            if (markdown.includes('```mermaid')) {
                throw new Error('Mermaid render failed');
            }
            el.setText(markdown);
        });
        const { view, containerEl, app } = createView({ withMarkdownLeaf: true });
        await view.onOpen();

        const content = '```mermaid\ngraph TD\nA --> B\n```';
        getTextArea(containerEl).value = 'broken graph';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        app.workspace.getActiveFile.mockReturnValue({ path: '0.unsorted/Cat.md', extension: 'md' });
        streamCalls[0].onChunk(content);
        await flushPromises();
        await flushPromises();

        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        expect(renderedMarkdown.some(({ markdown }) => markdown.includes('```mermaid'))).toBe(true);
        expect(renderedMarkdown[renderedMarkdown.length - 1].markdown).toContain('```text');
        expect(renderedMarkdown[renderedMarkdown.length - 1].sourcePath).toBe('0.unsorted/Dog.md');
        expect(allText(containerEl)).toContain('Mermaid diagram could not be rendered; showing source.');
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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

        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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
        expect(allText(responseDiv)).toContain('Working on: Draft answer before tools.');

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

    it.each([false, true])('keeps one zero-source reduction row live, saved and reloaded (budget=%s)', async (budgetLimited) => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'receipt-conversation' });
        const { view, containerEl } = createView({ chatHistoryManager: manager });
        await view.onOpen();
        getTextArea(containerEl).value = 'continue a long conversation';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        const call = streamCalls[0];
        emitCanonical(call, canonicalEvent({ type: 'agent_start' }));
        emitCanonical(call, canonicalEvent({ type: 'turn_start' }));
        emitCanonical(call, canonicalEvent({
            type: 'turn_end', status: 'tool_results_ready',
            metadata: { metrics: [{ type: 'context_projection', outcome: { admission: 'fit', historyCompressed: true } }] },
        }));
        expect(allText(getElementByClass(containerEl, 'context-reduction'))).toBe('Context was shortened');
        expect(getElementsByClass(containerEl, 'context-reduction')).toHaveLength(1);

        emitCanonical(call, canonicalEvent({ type: 'turn_start', turnId: 'turn_2' }));
        emitCanonical(call, canonicalEvent({
            type: 'message_end', turnId: 'turn_2',
            message: assistantMessage('answer', [{ type: 'text', text: 'Continuing our discussion.' }]),
        }));
        const metric = { type: 'context_projection', outcome: { admission: 'fit', toolResultsCompacted: 3, budgetLimited } };
        emitCanonical(call, canonicalEvent({
            type: 'turn_end', turnId: 'turn_2', status: 'completed',
            metadata: { metrics: [metric, metric, { type: 'context_projection', outcome: { admission: 'local_overflow', budgetLimited: true } }] },
        }));
        emitCanonical(call, canonicalEvent({ type: 'agent_end', status: 'completed', metadata: { finalTurnId: 'turn_2' } }));
        call.resolve();
        await flushPromises();
        await flushPromises();

        const label = budgetLimited ? 'Context was limited to fit this request' : 'Context was shortened';
        const receipt = { historyCompressed: true, toolContextReduced: true, budgetLimited };
        expect(getElementsByClass(containerEl, 'context-reduction')).toHaveLength(1);
        expect(allText(getElementByClass(containerEl, 'context-reduction'))).toBe(label);
        expect(view.chatHistory[1].memoryMetadata).toMatchObject({
            hasMemoryContent: false,
            allowedMemorySourcePaths: [],
            contextTrace: { usedSourceCount: 0, usedMemoryCount: 0, skippedScopeCount: 0, reduction: receipt },
        });
        expect(view.chatHistory[1].memoryMetadata?.contextUsed).toBeUndefined();
        expect((await store.getTurns('receipt-conversation'))[0].memoryMetadata?.contextTrace?.reduction).toEqual(receipt);
        const restored = createView({ chatHistoryManager: manager });
        await restored.view.onOpen();
        await flushPromises();
        await flushPromises();
        expect(getElementsByClass(restored.containerEl, 'context-reduction')).toHaveLength(1);
        expect(allText(getElementByClass(restored.containerEl, 'context-reduction'))).toBe(label);
        expect(restored.view.chatHistory[1].memoryMetadata?.contextTrace?.reduction).toEqual(receipt);
    });

    it.each([
        { locale: 'en', ask: 'Ask', title: 'Request is too long', detail: 'The current context is too long to continue.', earlierInvocation: false },
        { locale: 'zh', ask: '提问', title: '请求过长', detail: '当前上下文过长，无法继续处理。', earlierInvocation: true },
    ])('explains local overflow in $locale, including a rejected fallback after an earlier invocation', async ({ locale, ask, title, detail, earlierInvocation }) => {
        (globalThis.window as typeof globalThis.window & { i18next?: { language?: string } }).i18next = { language: locale };
        const chatHistoryManager = createWritableChatHistoryManager();
        const { view, containerEl } = createView({ chatHistoryManager });
        await view.onOpen();
        getTextArea(containerEl).value = 'oversized current input';
        void getButtonByText(containerEl, ask).click();
        await flushPromises();
        const call = streamCalls[0];
        emitCanonical(call, canonicalEvent({ type: 'agent_start' }));
        emitCanonical(call, canonicalEvent({ type: 'turn_start' }));
        const diagnostics = [{ type: 'context_local_overflow', message: 'INTERNAL_OVERFLOW_DETAIL' }];
        emitCanonical(call, canonicalEvent({
            type: 'turn_end', status: 'error', metadata: {
                diagnostics,
                metrics: [
                    ...(earlierInvocation ? [{ type: 'context_projection', outcome: { admission: 'fit', historyCompressed: true } }] : []),
                    { type: 'context_projection', outcome: { admission: 'local_overflow', budgetLimited: true } },
                ],
            },
        }));
        emitCanonical(call, canonicalEvent({ type: 'agent_end', status: 'error', metadata: { diagnostics } }));
        call.reject(new Error('PA Agent canonical runtime failed: INTERNAL_OVERFLOW_DETAIL'));
        await flushPromises();
        await flushPromises();

        expect(getElementByClass(containerEl, 'thinking-status-summary').textContent).toBe(title);
        expect(allText(containerEl)).toContain(detail);
        expect(allText(containerEl)).not.toContain('INTERNAL_OVERFLOW_DETAIL');
        expect(getElementsByClass(containerEl, 'thinking-status-warning-item')).toHaveLength(1);
        expect(getElementsByClass(containerEl, 'context-reduction')).toHaveLength(earlierInvocation ? 1 : 0);
        expect(view.chatHistory).toHaveLength(0);
        expect(streamCalls).toHaveLength(1);
        expect(chatHistoryManager.startConversation).not.toHaveBeenCalled();
        expect(chatHistoryManager.recordTurn).not.toHaveBeenCalled();
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
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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
        expect(mockResetChatContext).toHaveBeenCalledTimes(1);
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

        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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

    it('restores persisted history with role identicons and only eligible Share Card actions', async () => {
        const restoredUser: ChatMessage = { role: 'user', content: 'restored prompt' };
        const restoredAssistant: ChatMessage = { role: 'assistant', content: 'restored answer' };
        const restoredIneligibleUser: ChatMessage = { role: 'user', content: 'partial prompt' };
        const restoredIneligibleAssistant: ChatMessage = {
            role: 'assistant',
            content: 'partial restored answer',
            shareCardEligible: false,
        };
        const restoredEntry = {
            kind: 'history' as const,
            user: restoredUser,
            assistant: restoredAssistant,
        };
        const restoredIneligibleEntry = {
            kind: 'history' as const,
            user: restoredIneligibleUser,
            assistant: restoredIneligibleAssistant,
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
                turnCount: 2,
                preview: 'restored prompt',
            })),
            getTurns: jest.fn(async () => [
                {
                    conversationId: 'conv_restored',
                    turnIndex: 0,
                    user: { role: 'user' as const, content: 'restored prompt' },
                    assistant: { role: 'assistant' as const, content: 'restored answer' },
                },
                {
                    conversationId: 'conv_restored',
                    turnIndex: 1,
                    user: { role: 'user' as const, content: 'partial prompt' },
                    assistant: {
                        role: 'assistant' as const,
                        content: 'partial restored answer',
                        shareCardEligible: false,
                    },
                },
            ]),
            deserializeTurn: jest.fn((turn: { turnIndex: number }) => (
                turn.turnIndex === 0
                    ? {
                        userMessage: restoredUser,
                        assistantMessage: restoredAssistant,
                        historyEntry: restoredEntry,
                    }
                    : {
                        userMessage: restoredIneligibleUser,
                        assistantMessage: restoredIneligibleAssistant,
                        historyEntry: restoredIneligibleEntry,
                    }
            )),
            setActiveConversationId: jest.fn(async () => undefined),
        };
        const { view, containerEl, app } = createView({
            chatHistoryManager,
            withMarkdownLeaf: true,
        });

        await view.onOpen();
        await flushPromises();
        await flushPromises();

        expect(chatHistoryManager.deserializeTurn).toHaveBeenCalledTimes(2);
        expect(mockResetChatContext).toHaveBeenCalledTimes(1);
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
            restoredUser,
            restoredAssistant,
            restoredIneligibleUser,
            restoredIneligibleAssistant,
        ]);
        const restoredUserMessage = getElementByClass(containerEl, 'user');
        const restoredAssistantMessages = getElementsByClass(containerEl, 'assistant');
        const restoredAssistantMessage = restoredAssistantMessages[0];
        const restoredIneligibleAssistantMessage = restoredAssistantMessages[1];
        const restoredUserRole = getElementByClass(restoredUserMessage, 'message-role');
        const restoredAssistantRole = getElementByClass(restoredAssistantMessage, 'message-role');
        expect(getElementByClass(restoredUserRole, 'pa-chat-role-identicon-user').tagName).toBe('span');
        expect(getElementByClass(restoredAssistantRole, 'pa-chat-role-identicon-assistant').tagName).toBe('span');
        expect(restoredUserMessage.getAttribute('aria-busy')).toBeNull();
        expect(restoredAssistantMessage.getAttribute('aria-busy')).toBeNull();
        expect(getButtonsByClass(restoredUserMessage, 'share-card-message-button')).toHaveLength(0);
        expect(getButtonsByClass(restoredAssistantMessage, 'share-card-message-button')).toHaveLength(1);
        expect(getButtonsByClass(restoredIneligibleAssistantMessage, 'share-card-message-button')).toHaveLength(0);
        getButtonsByClass(restoredAssistantMessage, 'share-card-message-button')[0].click();
        expect(mockShareCardModalConstructor).toHaveBeenCalledWith(app, {
            content: 'restored answer',
            source: 'chat',
            sourceLabel: 'PA Chat',
            resourceContext: { basePath: '0.unsorted/Dog.md' },
        });
    });

    it('refreshes role identicon shapes when starting a new chat', async () => {
        const originalCrypto = globalThis.crypto;
        const randomUUID = jest.fn()
            .mockReturnValueOnce('constructor-seed')
            .mockReturnValueOnce('session-alpha')
            .mockReturnValueOnce('session-bravo');
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: { randomUUID },
        });

        try {
            const { view, containerEl } = createView();
            await view.onOpen();

            getTextArea(containerEl).value = 'first prompt';
            void getButtonByText(containerEl, 'Ask').click();
            await flushPromises();
            streamCalls[0].onChunk('first answer');
            streamCalls[0].resolve();
            await flushPromises();
            await flushPromises();
            const firstAssistantShape = getRoleIdenticonShapeSignature(containerEl, 'pa-chat-role-identicon-assistant');

            getButtonByText(containerEl, 'New Chat').click();
            await flushPromises();
            getTextArea(containerEl).value = 'second prompt';
            void getButtonByText(containerEl, 'Ask').click();
            await flushPromises();
            streamCalls[1].onChunk('second answer');
            streamCalls[1].resolve();
            await flushPromises();
            await flushPromises();
            const secondAssistantShape = getRoleIdenticonShapeSignature(containerEl, 'pa-chat-role-identicon-assistant');

            expect(randomUUID).toHaveBeenCalledTimes(3);
            expect(firstAssistantShape).not.toBe(secondAssistantShape);
            expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
                { role: 'user', content: 'second prompt' },
                { role: 'assistant', content: 'second answer' },
            ]);
        } finally {
            Object.defineProperty(globalThis, 'crypto', {
                configurable: true,
                value: originalCrypto,
            });
        }
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
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
            { role: 'user', content: 'first prompt' },
            { role: 'assistant', content: 'first answer' },
        ]);

        getButtonByText(containerEl, 'Clear Chat').click();
        await view.onClose();
        await flushPromises();
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
            { role: 'user', content: 'first prompt' },
            { role: 'assistant', content: 'first answer' },
        ]);
    });

    it('scopes chat confirmation modal styles to the chat confirmation shell', () => {
        const { app } = createView();
        const modal = new ChatConfirmationModal(
            { app: app as never },
            {
                title: 'Clear current chat?',
                message: 'This clears the current chat and draft.',
                confirmText: 'Clear current chat',
                danger: true,
            },
            jest.fn(),
        );
        const modalLike = modal as unknown as { modalEl: MockElement; contentEl: MockElement; onOpen: () => void };

        modalLike.modalEl = new MockElement('div');
        modalLike.contentEl = new MockElement('div');
        modalLike.onOpen();

        expect(modalLike.modalEl.classList.contains('pa-chat-confirmation-modal-shell')).toBe(true);
        expect(modalLike.contentEl.classList.contains('pa-chat-confirmation-modal')).toBe(true);
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

        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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
            (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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
        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
            { role: 'user', content: 'async prompt' },
            { role: 'assistant', content: 'async answer' },
        ]);
        expect(allText(containerEl)).toContain('async answer');
    });

    it('restores cancel controls after clearing while final markdown rendering is in flight', async () => {
        const { view, containerEl } = createView();
        const renderJobs: Array<{ markdown: string; el: MockElement; resolve: () => void }> = [];
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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
        (MarkdownRenderer.render as unknown as jest.Mock<(app: unknown, markdown: string, el: MockElement) => void | Promise<void>>).mockImplementation((_app: unknown, markdown: string, el: MockElement) => {
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

    describe.each([
        { state: 'active composition', isComposing: true, keyCode: 13 },
        { state: 'IME commit after compositionend', isComposing: false, keyCode: 229 },
    ])('composer keys during $state', ({ isComposing, keyCode }) => {
        it('leaves Enter to the IME and sends the complete draft on the next ordinary Enter', async () => {
            const { view, containerEl } = createView();
            await view.onOpen();

            const textArea = getTextArea(containerEl);
            textArea.value = '请解释 ';
            const preventDefault = jest.fn();
            textArea.dispatchEvent('keydown', {
                key: 'Enter', shiftKey: false, isComposing, keyCode, preventDefault,
            });
            await flushPromises();

            expect(preventDefault).not.toHaveBeenCalled();
            expect(streamCalls).toHaveLength(0);
            expect(textArea.value).toBe('请解释 ');

            // The IME commits its pending English word after its confirmation key.
            textArea.value = '请解释 skill';
            textArea.dispatchEvent('keydown', {
                key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, preventDefault,
            });
            await flushPromises();

            expect(preventDefault).toHaveBeenCalledTimes(1);
            expect(streamCalls).toHaveLength(1);
            expect(streamCalls[0].prompt).toBe('请解释 skill');
        });

        it('does not interrupt IME confirmation with a generation wait hint', async () => {
            const { view, containerEl } = createView();
            await view.onOpen();

            const textArea = getTextArea(containerEl);
            textArea.value = 'first prompt';
            void getButtonByText(containerEl, 'Ask').click();
            await flushPromises();

            textArea.value = '下一条 ';
            const preventDefault = jest.fn();
            textArea.dispatchEvent('keydown', {
                key: 'Enter', shiftKey: false, isComposing, keyCode, preventDefault,
            });

            expect(preventDefault).not.toHaveBeenCalled();
            expect(streamCalls).toHaveLength(1);
            expect(textArea.value).toBe('下一条 ');
            expect(allText(containerEl)).not.toContain('Wait for this answer to finish or stop it first.');
        });

        it('leaves Escape to the IME before handling ordinary skill-menu dismissal', async () => {
            const { view, containerEl } = createView();
            await view.onOpen();
            await flushPromises();

            const textArea = getTextArea(containerEl);
            textArea.value = '#';
            const typeahead = getElementByClass(containerEl, 'pa-chat-skill-typeahead');
            expect(typeahead.hidden).toBe(false);

            const preventDefault = jest.fn();
            textArea.dispatchEvent('keydown', {
                key: 'Escape', isComposing, keyCode: isComposing ? 27 : keyCode, preventDefault,
            });

            expect(preventDefault).not.toHaveBeenCalled();
            expect(typeahead.hidden).toBe(false);
            textArea.dispatchEvent('keydown', {
                key: 'Escape', isComposing: false, keyCode: 27, preventDefault,
            });
            expect(preventDefault).toHaveBeenCalledTimes(1);
            expect(typeahead.hidden).toBe(true);
        });
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

    it('localizes chat chrome from the Obsidian UI language hook', async () => {
        (globalThis.window as typeof globalThis.window & { i18next?: { language?: string } }).i18next = {
            language: 'zh-CN',
        };
        const { view, containerEl } = createView({ withMarkdownLeaf: true });
        await view.onOpen();
        await flushPromises();

        expect(getTextArea(containerEl).getAttribute('placeholder')).toBe('询问你的笔记...');
        expect(getButtonByText(containerEl, '提问').getAttribute('aria-label')).toBe('提问');
        expect(getButtonByText(containerEl, '总结当前笔记').disabled).toBe(false);
        expect(getElementByClass(containerEl, 'pa-chat-memory-chip').getAttribute('aria-label')).toBe('Memory 已就绪');

        getButtonByClass(containerEl, 'pa-chat-more-button').click();

        expect(getButtonByText(containerEl, '显示 Memory 状态')).toBeTruthy();
        expect(allText(containerEl)).toContain('询问你的笔记');
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

    it('refreshes the setup banner when Settings adds or removes the API token', async () => {
        const { view, containerEl, emitSettingsChanged, setAISetupIssue } = createView({
            withMarkdownLeaf: true,
            setupIssue: 'Add your API token in Settings first.',
        });
        await view.onOpen();

        expect(allText(containerEl)).toContain('Get Started');
        expect(allText(containerEl)).toContain('Add your API token in Settings first.');

        setAISetupIssue(null);
        await emitSettingsChanged();

        expect(allText(containerEl)).not.toContain('Get Started');
        expect(allText(containerEl)).not.toContain('Add your API token in Settings first.');
        expect(allText(containerEl)).toContain('Ask about your notes');
        expect(getButtonByText(containerEl, 'Summarize current note').disabled).toBe(false);

        setAISetupIssue('Add your API token in Settings first.');
        await emitSettingsChanged();

        expect(allText(containerEl)).toContain('Get Started');
        expect(allText(containerEl)).toContain('Add your API token in Settings first.');
    });

    it('checks an unknown saved token only after the user explicitly sends', async () => {
        const harness = createView({
            setupIssue: 'Your saved API token has not been checked yet.',
            inlineSetup: true,
            tokenState: 'unknown',
        });
        const { view, containerEl, plugin, setAISetupIssue, setTokenState } = harness;
        const refreshToken = plugin.refreshAPITokenPresence as jest.Mock;
        refreshToken.mockImplementation(() => {
            setTokenState('present');
            setAISetupIssue(null);
            return 'present';
        });
        await view.onOpen();

        expect(allText(containerEl)).not.toContain('Add your API token');
        expect(allText(containerEl)).not.toContain('Get Started');
        const textArea = getTextArea(containerEl);
        textArea.value = 'Hello';
        expect(refreshToken).not.toHaveBeenCalled();

        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        expect(refreshToken).toHaveBeenCalledTimes(1);
        expect(streamCalls).toHaveLength(1);
        streamCalls[0].resolve();
        await flushPromises();
    });

    it('keeps an unknown token neutral when an explicit check is unavailable', async () => {
        const { view, containerEl, plugin } = createView({
            setupIssue: 'Your saved API token has not been checked yet.',
            inlineSetup: true,
            tokenState: 'unknown',
        });
        await view.onOpen();
        getTextArea(containerEl).value = 'Hello';

        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        expect(plugin.refreshAPITokenPresence).toHaveBeenCalledTimes(1);
        expect(streamCalls).toHaveLength(0);
        expect(allText(containerEl)).toContain('has not been checked yet');
        expect(allText(containerEl)).not.toContain('Add your API token');
    });

    it('reuses an existing token when a provider preset completes partial setup', async () => {
        const { view, containerEl, plugin } = createView({
            setupIssue: 'Complete the AI provider URL and model in Settings first.',
            inlineSetup: true,
            tokenState: 'present',
        });
        await view.onOpen();

        const providerGroup = getElementByClass(containerEl, 'pa-chat-setup-providers');
        expect(providerGroup.getAttribute('role')).toBe('group');
        expect(providerGroup.getAttribute('aria-labelledby')).toBeTruthy();
        getButtonByText(containerEl, 'OpenAI').click();
        const tokenRow = getElementByClass(containerEl, 'pa-chat-setup-token-row');
        const start = getButtonByText(containerEl, 'Start');
        expect(tokenRow.classList.contains('pa-hidden')).toBe(true);
        expect(start.disabled).toBe(false);
        const completeAISetup = plugin.completeAISetup as jest.Mock;

        await start.click();

        expect(completeAISetup).toHaveBeenCalledWith({ presetKey: 'openai' });
    });

    it('keeps inline setup retryable with visible live feedback after a save failure', async () => {
        const { view, containerEl } = createView({
            setupIssue: 'Add your API token in Settings first.',
            inlineSetup: true,
            tokenState: 'missing',
            setupResult: { ok: false, code: 'settings_save_failed' },
        });
        await view.onOpen();

        const tokenInput = getElementByClass(containerEl, 'pa-chat-setup-token-input');
        const start = getButtonByText(containerEl, 'Start');
        const form = getElementByClass(containerEl, 'pa-chat-setup-form');
        expect(start.disabled).toBe(true);
        tokenInput.value = 'sk-test';
        expect(start.disabled).toBe(false);

        const pending = start.click() as Promise<void>;
        expect(form.getAttribute('aria-busy')).toBe('true');
        await pending;

        const status = getElementByClass(containerEl, 'pa-chat-setup-status');
        expect(status.getAttribute('role')).toBe('status');
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.classList.contains('is-error')).toBe(true);
        expect(allText(status)).toContain('Could not save this AI setup');
        expect(form.getAttribute('aria-busy')).toBeNull();
        expect(start.disabled).toBe(false);
    });

    it('submits valid token-only setup with Enter and restores composer focus', async () => {
        const documentWithFocus = { activeElement: null as MockElement | null };
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: documentWithFocus,
        });
        const { view, containerEl, plugin } = createView({
            setupIssue: 'Add your API token in Settings first.',
            inlineSetup: true,
            tokenState: 'missing',
        });
        await view.onOpen();
        const tokenInput = getElementByClass(containerEl, 'pa-chat-setup-token-input');
        tokenInput.value = 'sk-test';
        tokenInput.focus();
        const preventDefault = jest.fn();

        tokenInput.dispatchEvent('keydown', { key: 'Enter', preventDefault });
        await flushPromises();

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(plugin.completeAISetup).toHaveBeenCalledWith({ token: 'sk-test' });
        expect(documentWithFocus.activeElement).toBe(getTextArea(containerEl));
    });

    it('does not focus the composer after pointer setup submission', async () => {
        const documentWithFocus = { activeElement: null as MockElement | null };
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: documentWithFocus,
        });
        const { view, containerEl } = createView({
            setupIssue: 'Add your API token in Settings first.',
            inlineSetup: true,
            tokenState: 'missing',
        });
        await view.onOpen();
        const tokenInput = getElementByClass(containerEl, 'pa-chat-setup-token-input');
        tokenInput.value = 'sk-test';
        const start = getButtonByText(containerEl, 'Start');
        start.focus();

        await start.click(1);

        expect(documentWithFocus.activeElement).toBe(start);
        expect(documentWithFocus.activeElement).not.toBe(getTextArea(containerEl));
    });

    it('does not restore composer focus when keyboard setup finishes after the session closes', async () => {
        let resolveSetup: ((result: { ok: true }) => void) | undefined;
        const documentWithFocus = { activeElement: null as MockElement | null };
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: documentWithFocus,
        });
        const { view, containerEl, plugin } = createView({
            setupIssue: 'Add your API token in Settings first.',
            inlineSetup: true,
            tokenState: 'missing',
        });
        (plugin.completeAISetup as jest.Mock).mockImplementationOnce(() => new Promise<{ ok: true }>((resolve) => {
            resolveSetup = resolve;
        }));
        await view.onOpen();
        const tokenInput = getElementByClass(containerEl, 'pa-chat-setup-token-input');
        tokenInput.value = 'sk-test';
        tokenInput.focus();

        tokenInput.dispatchEvent('keydown', { key: 'Enter', preventDefault: jest.fn() });
        await flushPromises();
        await view.onClose();
        documentWithFocus.activeElement = null;
        resolveSetup!({ ok: true });
        await flushPromises();

        expect(documentWithFocus.activeElement).toBeNull();
    });

    it('keeps inline setup controls touch-sized on mobile', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');

        expect(css).toMatch(/body\.is-mobile\s+\.pa-chat-empty-chip\s*{[\s\S]*?min-height:\s*44px;/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-chat-setup-token-input\s*{[\s\S]*?min-height:\s*44px;[\s\S]*?font-size:\s*16px;/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-chat-setup-advanced-link\s*{[\s\S]*?min-height:\s*44px;/);
    });

    it('uses panel-width density classes instead of viewport media queries', async () => {
        const { view, containerEl } = createView({ panelWidth: 340 });
        await view.onOpen();

        expect(containerEl.classList.contains('is-narrow')).toBe(true);
        expect(containerEl.classList.contains('is-compact')).toBe(true);
    });

    it('keeps Operations cards scoped to Chat with touch-sized actions', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');
        const suggestionActions = getCssRuleBlock(
            css,
            '.pa-chat-view .pa-operations-save-suggestion__actions > button',
        );
        const intentActions = getCssRuleBlock(
            css,
            '.pa-chat-view .pa-operations-intent-card__undo',
        );

        expect(css).toContain('.pa-chat-view .pa-operations-save-suggestion {');
        expect(css).toContain('.pa-chat-view .pa-operations-intent-card {');
        expect(css).toMatch(/\.pa-chat-view \.pa-operations-intent-card \[hidden\] \{\s*display: none;\s*\}/);
        expect(suggestionActions).toContain('min-height: 44px;');
        expect(intentActions).toContain('min-height: 44px;');
    });

    it('keeps message actions discoverable in the bottom toolbar', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');

        expect(css).toMatch(/\.llm-view\s+\.message-actions\s*{[\s\S]*?position:\s*relative;[\s\S]*?display:\s*flex;[\s\S]*?gap:\s*6px;[\s\S]*?max-width:\s*100%;[\s\S]*?margin-top:\s*10px;[\s\S]*?opacity:\s*0\.72;/);
        expect(css).not.toMatch(/\.llm-view\s+\.message-actions\s*{[\s\S]*?width:\s*fit-content;/);
        expect(css).toMatch(/\.llm-view\s+\.llm-message\.user\s+\.message-actions\s*{[\s\S]*?justify-content:\s*flex-end;/);
        expect(css).toMatch(/@media\s*\(hover:\s*none\)\s*{[\s\S]*?\.llm-view\s+\.message-actions\s*{[\s\S]*?opacity:\s*1;/);
        expect(css).toMatch(/\.llm-view\.is-narrow\s+\.message-actions\s*{[\s\S]*?opacity:\s*1;/);
    });

    it('pins message action buttons to icon size in mobile button styles', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');

        expect(css).toMatch(/\.llm-view\s+button\.message-action-button\s*{[\s\S]*?appearance:\s*none;[\s\S]*?box-sizing:\s*border-box;[\s\S]*?background:\s*transparent;[\s\S]*?flex:\s*0 0 28px;[\s\S]*?min-width:\s*28px;[\s\S]*?min-height:\s*28px;[\s\S]*?max-width:\s*28px;[\s\S]*?max-height:\s*28px;[\s\S]*?box-shadow:\s*none;/);
        expect(css).toMatch(/\.llm-view\s+button\.message-action-button:focus\s*{[\s\S]*?outline:\s*none;/);
        expect(css).toMatch(/\.llm-view\s+button\.message-action-button:focus-visible:not\(:disabled\)\s*{[\s\S]*?box-shadow:\s*inset 0 0 0 1px var\(--interactive-accent\);/);
        expect(css).toMatch(/\.llm-view\s+button\.message-action-button\s+svg\s*{[\s\S]*?display:\s*block;[\s\S]*?flex:\s*0 0 auto;[\s\S]*?width:\s*var\(--pa-chat-button-icon-size\);[\s\S]*?height:\s*var\(--pa-chat-button-icon-size\);/);
        expect(css).toMatch(/\.llm-view\s+button\.message-action-button:hover:not\(:disabled\),[\s\S]*?\.llm-view\s+button\.message-action-button:focus-visible:not\(:disabled\)\s*{/);
        expect(css).toMatch(/@media\s*\(hover:\s*none\)\s*{[\s\S]*?\.llm-view\s+button\.message-action-button\s*{[\s\S]*?flex-basis:\s*44px;[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/);
    });

    it('overlays rendered code copy buttons until hover or keyboard focus', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');
        const codeBlock = getCssRuleBlock(css, '.llm-view .message-content pre');
        const copyButtonBlock = getCssRuleBlock(css, '.llm-view .message-content pre > button.copy-code-button');

        expect(codeBlock).toContain('position: relative;');
        expect(copyButtonBlock).toContain('position: absolute;');
        expect(copyButtonBlock).toContain('inset-block-start: 6px;');
        expect(copyButtonBlock).toContain('inset-inline-end: 6px;');
        expect(copyButtonBlock).toContain('opacity: 0;');
        expect(copyButtonBlock).toContain('pointer-events: none;');
        expect(copyButtonBlock).not.toContain('display: none;');
        expect(css).toMatch(/\.llm-view\s+\.message-content\s+pre:hover\s*>\s*button\.copy-code-button,\s*\n\.llm-view\s+\.message-content\s+pre:focus-within\s*>\s*button\.copy-code-button\s*{[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/);
        expect(css).toMatch(/@media\s*\(hover:\s*none\)\s*{[\s\S]*?\.llm-view\s+\.message-content\s+pre\s*>\s*button\.copy-code-button\s*{[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/);
    });

    it('allows selecting rendered message text', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');
        const messageContentBlock = getCssRuleBlock(css, '.llm-view .message-content');

        expect(messageContentBlock).toContain('-webkit-user-select: text;');
        expect(messageContentBlock).toContain('user-select: text;');
    });

    it('opens message overflow menus upward from the bottom toolbar', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');
        const sharedMenuItemBlock = getCssRuleBlock(css, '.pa-chat-menu .pa-chat-menu-item');
        const messageMenuItemBlock = getCssRuleBlock(css, '.pa-chat-message-menu .pa-chat-menu-item');

        expect(css).toMatch(/\.pa-chat-message-menu\s*{[\s\S]*?--pa-chat-menu-min-width:\s*96px;[\s\S]*?top:\s*auto;[\s\S]*?bottom:\s*calc\(100% \+ 8px\);[\s\S]*?padding:\s*3px;/);
        expect(css).toMatch(/\.llm-view\s+\.llm-message\.assistant\s+\.pa-chat-message-menu,[\s\S]*?\.llm-view\s+\.llm-message\.system\s+\.pa-chat-message-menu\s*{[\s\S]*?right:\s*auto;[\s\S]*?left:\s*0;/);
        expect(css).toMatch(/\.llm-view\s+\.llm-message\.assistant\s+\.message-actions\s*{[\s\S]*?--pa-chat-message-menu-arrow-left:\s*110px;[\s\S]*?--pa-chat-message-menu-arrow-right:\s*auto;/);
        expect(css).toMatch(/\.llm-view\s+\.llm-message\.system\s+\.message-actions\s*{[\s\S]*?--pa-chat-message-menu-arrow-left:\s*76px;[\s\S]*?--pa-chat-message-menu-arrow-right:\s*auto;/);
        expect(css).toMatch(/@media\s*\(hover:\s*none\)\s*{[\s\S]*?\.llm-view\s+\.llm-message\.assistant\s+\.message-actions\s*{[\s\S]*?--pa-chat-message-menu-arrow-left:\s*166px;[\s\S]*?\.llm-view\s+\.llm-message\.system\s+\.message-actions\s*{[\s\S]*?--pa-chat-message-menu-arrow-left:\s*116px;/);
        expect(css).toMatch(/@media\s*\(hover:\s*none\)\s*{\s*\.pa-chat-message-menu\s*{\s*--pa-chat-menu-min-width:\s*144px;/);
        expect(css).toMatch(/\.pa-chat-message-menu::after\s*{[\s\S]*?top:\s*auto;[\s\S]*?right:\s*var\(--pa-chat-message-menu-arrow-right\);[\s\S]*?left:\s*var\(--pa-chat-message-menu-arrow-left\);[\s\S]*?bottom:\s*-6px;[\s\S]*?border-right:\s*1px solid var\(--background-modifier-border\);[\s\S]*?border-bottom:\s*1px solid var\(--background-modifier-border\);/);
        expect(css).toMatch(/\.pa-chat-message-menu\.pa-chat-message-menu-below\s*{[\s\S]*?top:\s*calc\(100% \+ 8px\);[\s\S]*?bottom:\s*auto;/);
        expect(sharedMenuItemBlock).toContain('box-sizing: border-box;');
        expect(sharedMenuItemBlock).toContain('grid-template-columns: 18px minmax(0, 1fr);');
        expect(sharedMenuItemBlock).toContain('min-height: 38px;');
        expect(sharedMenuItemBlock).toContain('gap: 0 10px;');
        expect(css.indexOf('.pa-chat-message-menu .pa-chat-menu-item {')).toBeGreaterThan(css.indexOf('.pa-chat-menu .pa-chat-menu-item {'));
        expect(messageMenuItemBlock).toContain('grid-template-columns: 18px minmax(0, max-content);');
        expect(messageMenuItemBlock).toContain('justify-content: center;');
        expect(messageMenuItemBlock).toContain('padding: 0 8px;');
        expect(messageMenuItemBlock).not.toContain('font-size');
    });

    it('sizes role identicons for desktop and compact chat panes', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');
        const assistantIdenticonModel = getChatRoleIdenticonModel('assistant');
        const identiconBlock = getCssRuleBlock(css, '.llm-view .pa-chat-role-identicon');

        expect(css).toMatch(/\.llm-view\s+\.message-role\s*{[\s\S]*?--pa-chat-role-icon-size:\s*20px;[\s\S]*?--pa-chat-role-icon-padding:\s*2px;[\s\S]*?gap:\s*6px;/);
        expect(css).toMatch(/\.llm-view\s+\.pa-chat-role-identicon\s*{[\s\S]*?flex:\s*0 0 var\(--pa-chat-role-icon-size\);[\s\S]*?width:\s*var\(--pa-chat-role-icon-size\);[\s\S]*?height:\s*var\(--pa-chat-role-icon-size\);[\s\S]*?padding:\s*var\(--pa-chat-role-icon-padding\);/);
        expect(identiconBlock).toContain('border-radius: 8px;');
        expect(identiconBlock).not.toContain('border-radius: 50%;');
        expect(css).toMatch(/\.llm-view\.is-compact\s+\.message-role\s*{[\s\S]*?--pa-chat-role-icon-size:\s*22px;[\s\S]*?gap:\s*7px;/);
        expect(assistantIdenticonModel.viewBox).toBe('-3 -3 26 26');
        expect(assistantIdenticonModel.cellSize).toBe(4);
    });

    it('keeps role identicon colors stable while varying shapes by session seed', () => {
        const firstAssistantModel = getChatRoleIdenticonModel('assistant', 'session-alpha');
        const secondAssistantModel = getChatRoleIdenticonModel('assistant', 'session-alpha');
        const nextAssistantModel = getChatRoleIdenticonModel('assistant', 'session-bravo');
        const userModel = getChatRoleIdenticonModel('user', 'session-alpha');

        expect(firstAssistantModel.cells).toEqual(secondAssistantModel.cells);
        expect(firstAssistantModel.emptyCells).toEqual(secondAssistantModel.emptyCells);
        expect(firstAssistantModel.cells).not.toEqual(nextAssistantModel.cells);
        expect(firstAssistantModel.emptyCells).not.toEqual(nextAssistantModel.emptyCells);
        expect(userModel.cells).not.toEqual(firstAssistantModel.cells);
        expect(firstAssistantModel.fill).toBe('var(--pa-chat-role-identicon-purple)');
        expect(nextAssistantModel.fill).toBe(firstAssistantModel.fill);
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
        const css = readFileSync('src/custom.pcss', 'utf8');
        const reducedMotionStart = css.indexOf('@media (prefers-reduced-motion: reduce)');
        const reducedMotionEnd = css.indexOf('.llm-view.is-narrow', reducedMotionStart);
        const reducedMotionBlock = css.slice(reducedMotionStart, reducedMotionEnd);

        expect(reducedMotionStart).toBeGreaterThanOrEqual(0);
        expect(reducedMotionEnd).toBeGreaterThan(reducedMotionStart);
        expect(reducedMotionBlock).not.toContain('.pa-chat-role-loader-element');
        expect(reducedMotionBlock).not.toMatch(/\.pa-chat-role-loader-fallback\s*{[\s\S]*?display:\s*inline-flex;/);
    });

    it('uses a bright vivid color cycle for ldrs chat loaders', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');
        const colorCycleStart = css.indexOf('@keyframes pa-chat-loader-color-cycle');
        const colorCycleEnd = css.indexOf('.llm-view .thinking-status-header', colorCycleStart);
        const colorCycleBlock = css.slice(colorCycleStart, colorCycleEnd);

        expect(colorCycleStart).toBeGreaterThanOrEqual(0);
        expect(colorCycleEnd).toBeGreaterThan(colorCycleStart);
        expect(css).toContain('--pa-chat-loader-color-rose: #e84466;');
        expect(css).toContain('--pa-chat-loader-color-orange: #e89a2a;');
        expect(css).toContain('--pa-chat-loader-color-lime: #48c25e;');
        expect(css).toContain('--pa-chat-loader-color-cyan: #2ab8e0;');
        expect(css).toContain('--pa-chat-loader-color-violet: #b06de0;');
        expect(colorCycleBlock).not.toContain('--interactive-accent');
        expect(colorCycleBlock).not.toContain('--color-cyan');
        expect(colorCycleBlock).not.toContain('--color-green');
        expect(colorCycleBlock).not.toContain('--color-yellow');
    });

    it('pins the Thinking status toggle so theme button defaults cannot add leading space', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');
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
        const css = readFileSync('src/custom.pcss', 'utf8');
        const drawerInnerBlock = getCssRuleBlock(css, '.workspace-drawer-inner.pa-chat-drawer-host');
        const mobileDrawerInnerBlock = getCssRuleBlock(css, 'body.is-mobile .workspace-drawer-inner.pa-chat-drawer-host');
        const mobileViewBlock = getCssRuleBlock(css, 'body.is-mobile .llm-view');
        const mobileInputBlock = getCssRuleBlock(css, 'body.is-mobile .llm-input');
        const mobileTextareaBlock = getCssRuleBlock(css, 'body.is-mobile .llm-input textarea');
        const mobileButtonsBlock = getCssRuleBlock(css, 'body.is-mobile .llm-buttons');
        const iconButtonBlock = getCssRuleBlock(css, '.pa-chat-icon-button,\n.llm-buttons button.pa-chat-icon-button');
        const iconButtonSvgBlock = getCssRuleBlock(css, '.pa-chat-icon-button svg,\n.llm-buttons button.pa-chat-icon-button svg');
        const memoryChipBlock = getCssRuleBlock(css, '.pa-chat-memory-chip,\n.llm-buttons button.pa-chat-memory-chip');
        const memoryChipSvgBlock = getCssRuleBlock(css, '.pa-chat-memory-chip svg,\n.llm-buttons button.pa-chat-memory-chip svg');
        const cancelButtonBlock = getCssRuleBlock(css, '.llm-buttons button.cancel-button');
        const mobileIconButtonBlock = getCssRuleBlock(css, 'body.is-mobile .llm-buttons button.pa-chat-icon-button');
        const mobileIconButtonHitAreaBlock = getCssRuleBlock(css, 'body.is-mobile .llm-buttons button.pa-chat-icon-button::before');
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

        expect(css).toMatch(/\.llm-view\s*{[\s\S]*?--pa-chat-keyboard-clearance:\s*0px;[\s\S]*?--pa-chat-keyboard-accessory-clearance:\s*0px;[\s\S]*?--pa-chat-keyboard-offset:\s*0px;[\s\S]*?--pa-chat-composer-height:\s*0px;[\s\S]*?--pa-chat-button-icon-size:\s*14px;[\s\S]*?--pa-chat-keyboard-motion:\s*180ms cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\);[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?padding:\s*0 0 var\(--pa-chat-keyboard-clearance,\s*0px\);[\s\S]*?position:\s*relative;/);
        expect(css).not.toMatch(/\.llm-view\s*{[^}]*transition:\s*padding-bottom/);
        expect(css).not.toMatch(/\.llm-view\.is-keyboard-open\s*{[\s\S]*?padding-bottom:\s*0;/);
        expect(drawerInnerBlock).toContain('padding-bottom: max(6px, env(safe-area-inset-bottom, 6px));');
        expect(mobileDrawerInnerBlock).toContain('--pa-chat-drawer-top-clearance: clamp(10px, calc(env(safe-area-inset-top, 0px) - 24px), 24px);');
        expect(mobileDrawerInnerBlock).toContain('padding-top: var(--pa-chat-drawer-top-clearance);');
        expect(mobileViewBlock).toContain('--pa-chat-button-icon-size: 12px;');
        expect(mobileViewBlock).toContain('padding-bottom: 0;');
        expect(css).toMatch(/\.llm-chat-container\s*{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;/);
        expect(css).toMatch(/\.llm-chat-container\s*{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/);
        expect(css).toMatch(/\.llm-chat-container::before\s*{[\s\S]*?content:\s*"";[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;[\s\S]*?pointer-events:\s*none;/);
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
        expect(iconButtonBlock).toContain('width: 30px;');
        expect(iconButtonBlock).toContain('height: 30px;');
        expect(iconButtonBlock).toContain('flex: 0 0 30px;');
        expect(iconButtonBlock).toContain('border-radius: 7px;');
        expect(iconButtonSvgBlock).toContain('width: var(--pa-chat-button-icon-size);');
        expect(iconButtonSvgBlock).toContain('height: var(--pa-chat-button-icon-size);');
        expect(memoryChipBlock).toContain('width: 30px;');
        expect(memoryChipBlock).toContain('height: 30px;');
        expect(memoryChipBlock).toContain('flex: 0 0 30px;');
        expect(memoryChipBlock).toContain('border-radius: 7px;');
        expect(memoryChipSvgBlock).toContain('width: var(--pa-chat-button-icon-size);');
        expect(memoryChipSvgBlock).toContain('height: var(--pa-chat-button-icon-size);');
        expect(cancelButtonBlock).toContain('width: 30px;');
        expect(cancelButtonBlock).toContain('height: 30px;');
        expect(cancelButtonBlock).toContain('border-radius: 7px;');
        expect(mobileIconButtonBlock).toContain('width: 28px;');
        expect(mobileIconButtonBlock).toContain('height: 28px;');
        expect(mobileIconButtonBlock).toContain('flex: 0 0 28px;');
        expect(mobileIconButtonBlock).toContain('border-radius: 8px;');
        expect(mobileIconButtonHitAreaBlock).toContain('content: "";');
        expect(mobileIconButtonHitAreaBlock).toContain('inset: -8px;');
        expect(mobileIconButtonHitAreaBlock).toContain('border-radius: 14px;');
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
        expect(css).toMatch(/\.popover\.resize-popover-width\s+\.popover-content\s*{[\s\S]*?width:\s*var\(--resize-popover-width\);/);
        expect(css).not.toMatch(/\.llm-view\.is-keyboard-native-fallback\s*{[\s\S]*?--pa-chat-keyboard-accessory-clearance:/);
        expect(css).not.toMatch(/\.is-keyboard-native-fallback\s+\.pa-chat-keyboard-spacer\s*{[\s\S]*?transition:/);
        expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*?\.llm-input\s*{[\s\S]*?transition:\s*none;/);
    });

    it('keeps Mermaid preview controls usable on narrow mobile panes', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');
        const chatContainerBlock = getCssRuleBlock(css, '.llm-chat-container');
        const messageBlock = getCssRuleBlock(css, '.llm-message');
        const messageContentBlock = getCssRuleBlock(css, '.llm-view .message-content');
        const renderBufferBlock = getCssRuleBlock(css, '.llm-view .message-render-buffer');
        const shellBlock = getCssRuleBlock(css, '.llm-view .pa-chat-mermaid-shell');
        const viewportBlock = getCssRuleBlock(css, '.llm-view .pa-chat-mermaid-viewport');
        const diagramBlock = getCssRuleBlock(css, '.llm-view .pa-chat-mermaid-viewport > .mermaid,\n.llm-view .pa-chat-mermaid-viewport > .block-language-mermaid');
        const svgBlock = getCssRuleBlock(css, '.llm-view .pa-chat-mermaid-viewport svg');

        expect(chatContainerBlock).toContain('box-sizing: border-box;');
        expect(chatContainerBlock).toContain('display: flex;');
        expect(chatContainerBlock).toContain('flex-direction: column;');
        expect(chatContainerBlock).toContain('min-width: 0;');
        expect(chatContainerBlock).toContain('width: 100%;');
        expect(chatContainerBlock).toContain('overflow-x: hidden;');
        expect(chatContainerBlock).toContain('overscroll-behavior-x: none;');
        expect(chatContainerBlock).toContain('overscroll-behavior-y: contain;');
        expect(messageBlock).toContain('min-width: 0;');
        expect(messageContentBlock).toContain('box-sizing: border-box;');
        expect(messageContentBlock).toContain('overflow-x: hidden;');
        expect(renderBufferBlock).toContain('box-sizing: border-box;');
        expect(renderBufferBlock).toContain('width: 100%;');
        expect(renderBufferBlock).toContain('overflow-x: hidden;');
        expect(shellBlock).toContain('box-sizing: border-box;');
        expect(shellBlock).toContain('min-width: 0;');
        expect(shellBlock).toContain('width: 100%;');
        expect(viewportBlock).toContain('box-sizing: border-box;');
        expect(viewportBlock).toContain('min-width: 0;');
        expect(viewportBlock).toContain('width: 100%;');
        expect(viewportBlock).toContain('overflow-x: auto;');
        expect(viewportBlock).toContain('overflow-y: auto;');
        expect(viewportBlock).toContain('touch-action: pan-x pan-y;');
        expect(diagramBlock).toContain('display: block;');
        expect(diagramBlock).toContain('width: max-content;');
        expect(svgBlock).toContain('min-width: 100%;');
        expect(css).toMatch(/\.llm-view\s+\.pa-chat-mermaid-viewport\s*{[\s\S]*?-webkit-overflow-scrolling:\s*touch;[\s\S]*?overscroll-behavior:\s*contain;/);
        expect(css).toMatch(/body\.is-mobile\s+\.llm-view\s+\.pa-chat-mermaid-shell,\s*\nbody\.is-mobile\s+\.llm-view\s+\.pa-chat-mermaid-viewport\s*{[\s\S]*?max-width:\s*100%;/);
        expect(css).toMatch(/\.llm-view\.is-narrow\s+\.pa-chat-mermaid-open-button\s*{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;[\s\S]*?min-width:\s*40px;[\s\S]*?min-height:\s*40px;/);
        expect(css).toMatch(/\.pa-chat-mermaid-modal-viewport\s*{[\s\S]*?-webkit-overflow-scrolling:\s*touch;[\s\S]*?overscroll-behavior:\s*contain;/);
    });

    it('keeps chat history rows inside the modal width on mobile', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');

        expect(css).toMatch(/\.pa-chat-history-modal-shell\s*{[\s\S]*?width:\s*min\(720px,\s*calc\(100vw - 32px\)\);[\s\S]*?overflow-x:\s*hidden;/);
        expect(css).toMatch(/\.pa-chat-history-list\s*{[\s\S]*?list-style:\s*none;[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*hidden;/);
        expect(css).toMatch(/\.pa-chat-history-item\s*{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*44px;[\s\S]*?min-width:\s*0;/);
        expect(css).toMatch(/\.pa-chat-history-open\s*{[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;/);
        expect(css).toMatch(/\.pa-chat-history-title,\s*\n\.pa-chat-history-preview,\s*\n\.pa-chat-history-meta\s*{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
        expect(css).toMatch(/body\.is-mobile\s+\.pa-chat-history-modal-shell\s*{[\s\S]*?max-width:\s*calc\(100vw - 24px\);/);
    });

    it('keeps destructive chat confirmation hover contrast high', () => {
        const css = readFileSync('src/custom.pcss', 'utf8');
        const baseWarningBlock = getCssRuleBlock(css, '.pa-chat-confirmation-modal button.mod-warning,\n.pa-chat-confirmation-modal button.mod-destructive');
        const hoverWarningBlock = getCssRuleBlock(css, '.pa-chat-confirmation-modal button.mod-warning:hover,\n.pa-chat-confirmation-modal button.mod-warning:focus-visible,\n.pa-chat-confirmation-modal button.mod-destructive:hover,\n.pa-chat-confirmation-modal button.mod-destructive:focus-visible');
        const activeWarningBlock = getCssRuleBlock(css, '.pa-chat-confirmation-modal button.mod-warning:active,\n.pa-chat-confirmation-modal button.mod-destructive:active');

        expect(baseWarningBlock).toContain('background-color: color-mix(in srgb, var(--text-error, #ef4444) 14%, var(--background-primary));');
        expect(baseWarningBlock).toContain('color: var(--text-error, #ef4444);');
        expect(baseWarningBlock).not.toContain('color: var(--text-on-accent, #ffffff);');
        expect(hoverWarningBlock).toContain('background-color: color-mix(in srgb, var(--text-error, #ef4444) 86%, #7f1d1d);');
        expect(hoverWarningBlock).toContain('color: var(--text-on-accent, #ffffff);');
        expect(activeWarningBlock).toContain('background-color: color-mix(in srgb, var(--text-error, #ef4444) 72%, #7f1d1d);');
        expect(activeWarningBlock).toContain('color: var(--text-on-accent, #ffffff);');
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
        const css = readFileSync('src/custom.pcss', 'utf8');
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

        expect(composerRow.children).toEqual([
            getElementByClass(containerEl, 'pa-chat-image-draft'), getTextArea(containerEl), actions,
        ]);
        expect(actions.parentElement).toBe(composerRow);
        expect(actions.children.filter((child) => child.tagName !== 'input')).toEqual([
            getButtonByClass(containerEl, 'pa-chat-add-images'), askButton, memoryControl, cancelButton, moreControl,
        ]);
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
                body: {
                    querySelector: jest.fn((selector: string) => selector === '.status-bar' ? statusBar : null),
                },
            },
        });

        await view.onOpen();

        expect(containerEl.style.getPropertyValue('--pa-chat-status-bar-clearance')).toBe('28px');
    });

    it('rechecks status bar clearance after the first chat layout frame settles', async () => {
        const { view, containerEl } = createView({ panelWidth: 900 });
        const statusBar = new MockElement('div');
        containerEl.boundingRect = { left: 0, top: 0, right: 900, bottom: 0, width: 900, height: 0 };
        statusBar.boundingRect = { left: 600, top: 672, right: 900, bottom: 700, width: 300, height: 28 };
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                body: {
                    querySelector: jest.fn((selector: string) => selector === '.status-bar' ? statusBar : null),
                },
            },
        });

        await view.onOpen();

        expect(containerEl.style.getPropertyValue('--pa-chat-status-bar-clearance')).toBe('0px');
        expect(animationFrames).toHaveLength(1);

        containerEl.boundingRect = { left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 };
        runAnimationFrames();

        expect(containerEl.style.getPropertyValue('--pa-chat-status-bar-clearance')).toBe('28px');
    });

    it('updates bottom clearance when the Obsidian status bar appears after chat opens', async () => {
        const { view, containerEl } = createView({ panelWidth: 900 });
        const body = new MockElement('body');
        type MockMutationObserverInstance = {
            callback: MutationCallback;
            observe: jest.Mock;
            disconnect: jest.Mock;
        };
        const mutationObservers: MockMutationObserverInstance[] = [];
        class MockMutationObserver {
            readonly observe = jest.fn();
            readonly disconnect = jest.fn();

            constructor(readonly callback: MutationCallback) {
                mutationObservers.push(this);
            }
        }
        containerEl.boundingRect = { left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700 };
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: { body },
        });
        Object.defineProperty(globalThis, 'MutationObserver', {
            configurable: true,
            value: MockMutationObserver,
        });

        await view.onOpen();
        expect(containerEl.style.getPropertyValue('--pa-chat-status-bar-clearance')).toBe('0px');
        expect(mutationObservers).toHaveLength(1);
        expect(mutationObservers[0].observe).toHaveBeenCalledWith(body, {
            attributes: true,
            attributeFilter: ['class', 'style'],
            childList: true,
            subtree: true,
        });

        const unrelated = body.createDiv({ cls: 'not-status-bar' });
        mutationObservers[0].callback([
            {
                type: 'childList',
                target: body,
                addedNodes: [unrelated],
            } as unknown as MutationRecord,
        ], {} as MutationObserver);
        expect(animationFrames).toHaveLength(0);

        const statusBar = body.createDiv({ cls: 'status-bar' });
        statusBar.boundingRect = { left: 600, top: 672, right: 900, bottom: 700, width: 300, height: 28 };
        mutationObservers[0].callback([
            {
                type: 'childList',
                target: body,
                addedNodes: [statusBar],
            } as unknown as MutationRecord,
        ], {} as MutationObserver);
        mutationObservers[0].callback([
            {
                type: 'attributes',
                target: statusBar,
                addedNodes: [],
                removedNodes: [],
            } as unknown as MutationRecord,
        ], {} as MutationObserver);

        expect(animationFrames).toHaveLength(1);
        runAnimationFrames();
        expect(containerEl.style.getPropertyValue('--pa-chat-status-bar-clearance')).toBe('28px');

        const laterUnrelated = body.createDiv({ cls: 'still-not-status-bar' });
        mutationObservers[0].callback([
            {
                type: 'childList',
                target: body,
                addedNodes: [laterUnrelated],
            } as unknown as MutationRecord,
        ], {} as MutationObserver);
        expect(animationFrames).toHaveLength(0);

        await view.onClose();
        expect(mutationObservers[0].disconnect).toHaveBeenCalled();
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
        const windowWithKeyboardEvents = globalThis.window as Omit<typeof globalThis.window, 'addEventListener' | 'removeEventListener'> & {
            innerHeight: number;
            innerWidth: number;
            addEventListener: jest.Mock<(type: string, listener: EventListener) => void>;
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
        const windowWithKeyboardEvents = globalThis.window as Omit<typeof globalThis.window, 'addEventListener' | 'removeEventListener'> & {
            innerHeight: number;
            innerWidth: number;
            addEventListener: jest.Mock<(type: string, listener: EventListener) => void>;
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
        const windowWithKeyboardEvents = globalThis.window as Omit<typeof globalThis.window, 'addEventListener' | 'removeEventListener'> & {
            innerHeight: number;
            innerWidth: number;
            addEventListener: jest.Mock<(type: string, listener: EventListener) => void>;
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
        const windowWithKeyboardEvents = globalThis.window as Omit<typeof globalThis.window, 'addEventListener' | 'removeEventListener'> & {
            innerHeight: number;
            innerWidth: number;
            addEventListener: jest.Mock<(type: string, listener: EventListener) => void>;
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

    it('shows unavailable Memory as status-only context instead of citation-eligible context', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'memory unavailable prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: false,
            allowedMemorySourcePaths: [],
            contextUsed: [{
                category: 'memory',
                label: 'Selected Memory',
                detail: '0 selected notes',
                sources: [],
                citationEligible: false,
                statusOnly: true,
            }],
        });
        streamCalls[0].onChunk('Memory from notes was unavailable.');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const text = allText(containerEl);
        expect(text).toContain('Context Used');
        expect(text).toContain('Selected Memory');
        expect(text).toContain('0 selected notes');
        expect(text).toContain('Status only');
        expect(text).not.toContain('Eligible for Memory references');
        expect(getElementsByClass(containerEl, 'pa-chat-source-bar')).toHaveLength(0);
    });

    it('opens the exact Saved understanding Settings target from Context Used', async () => {
        const { view, containerEl, plugin } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'context prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].options.onTurnMetadata?.({
            hasMemoryContent: true,
            allowedMemorySourcePaths: [],
            contextUsed: [{
                category: 'memory',
                label: 'Saved understanding',
                statusOnly: true,
                memoryClaimId: 'claim-exact-42',
                memoryEffect: 'future_answers',
                memorySource: 'interactions',
                memoryScope: 'current_vault',
            }],
        });
        streamCalls[0].onChunk('answer from governed Memory');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        getButtonByText(containerEl, 'Saved understanding').click();

        expect(plugin.openMemorySettings).toHaveBeenCalledTimes(1);
        expect(plugin.openMemorySettings).toHaveBeenCalledWith('claim-exact-42');
        expect(allText(containerEl)).toContain('Used to shape this answer');
        expect(allText(containerEl)).toContain('From your interactions');
        expect(allText(containerEl)).toContain('Current vault');
        expect(allText(containerEl)).toContain('Personalization context, not a note citation');
        expect(allText(containerEl)).not.toContain('Status only');
        expect(allText(containerEl)).not.toContain('Prefers concise replies');
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

        expect(view.chatHistory.map(({ hostProvenance: _provenance, ...message }) => message)).toEqual([
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
        const { view, containerEl, plugin, app } = createView();
        await view.onOpen();

        const moreButton = getButtonByClass(containerEl, 'pa-chat-more-button');
        const composerMenu = getElementByClass(containerEl, 'pa-chat-composer-menu');
        expect(composerMenu.hidden).toBe(true);
        expect(getButtonsByText(composerMenu, 'Add original from Files')).toHaveLength(0);
        expect(getButtonsByText(composerMenu, 'Add image from vault')).toHaveLength(0);
        expect(getButtonsByText(composerMenu, 'Manage saved originals')).toHaveLength(0);

        moreButton.click();
        expect(composerMenu.hidden).toBe(false);
        expect(moreButton.getAttribute('aria-expanded')).toBe('true');

        const memoryStatusButton = getButtonByText(containerEl, 'Show Memory Status');
        const memoryStatusIcon = getElementByClass(memoryStatusButton, 'pa-chat-menu-item-icon');
        const memoryStatusText = getElementByClass(memoryStatusButton, 'pa-chat-menu-item-text');
        expect(memoryStatusText.textContent).toBe('Show Memory Status');
        expect(memoryStatusButton.getAttribute('title')).toBe(memoryStatusText.textContent);
        expect(memoryStatusButton.children).toEqual([memoryStatusIcon, memoryStatusText]);
        memoryStatusButton.click();
        expect(plugin.memoryStatus.showTechnicalStatus).toHaveBeenCalledTimes(1);

        getButtonByText(composerMenu, 'Open settings').click();
        expect(app.setting.open).toHaveBeenCalledTimes(1);
        expect(app.setting.openTabById).toHaveBeenCalledWith('personal-assistant');
        expect(plugin.openMemorySettings).not.toHaveBeenCalled();
    });

    it.each([null, 'completed', 'prepared', 'partial', 'failed'])('shows unfinished saves only for a real pending record: %s', async (state) => {
        const { view, containerEl, plugin } = createView();
        const listReceipts = jest.fn(async () => state ? [{ state }] : []);
        Object.assign(plugin, { writingSave: { listReceipts }, writingVersions: {} });
        await view.onOpen();
        const pending = getButtonByText(containerEl, 'Unfinished note saves');
        const more = getButtonByClass(containerEl, 'pa-chat-more-button');
        expect(pending.hidden).toBe(true);
        more.click();
        expect(getElementByClass(containerEl, 'pa-chat-composer-menu').hidden).toBe(false);
        await flushPromises();
        expect(pending.hidden).toBe(!state || state === 'completed');
        more.click();
        listReceipts.mockResolvedValue([]);
        more.click(); await flushPromises();
        expect(pending.hidden).toBe(true);
        expect(listReceipts).toHaveBeenCalledTimes(2);
        const css = readFileSync('src/custom.pcss', 'utf8');
        expect(getCssRuleBlock(css, '.pa-chat-menu .pa-chat-menu-item[hidden]')).toContain('display: none;');
    });

    it('ignores an older unfinished-save query after closing and reopening More', async () => {
        const { view, containerEl, plugin } = createView();
        const resolve: Array<(receipts: Array<{ state: string }>) => void> = [];
        const listReceipts = jest.fn(() => new Promise<Array<{ state: string }>>(done => { resolve.push(done); }));
        Object.assign(plugin, { writingSave: { listReceipts }, writingVersions: {} });
        await view.onOpen();
        const pending = getButtonByText(containerEl, 'Unfinished note saves');
        const more = getButtonByClass(containerEl, 'pa-chat-more-button');
        more.click(); more.click(); more.click();
        resolve[1]([]); await flushPromises();
        resolve[0]([{ state: 'partial' }]); await flushPromises();
        expect(pending.hidden).toBe(true);
        more.click(); more.click();
        await view.onClose();
        resolve[2]([{ state: 'failed' }]); await flushPromises();
        expect(pending.hidden).toBe(true);
    });

    it('keeps More usable when unfinished-save storage cannot be read', async () => {
        const { view, containerEl, plugin } = createView();
        Object.assign(plugin, { writingSave: { listReceipts: async () => { throw new Error('unavailable'); } }, writingVersions: {} });
        await view.onOpen();
        getButtonByClass(containerEl, 'pa-chat-more-button').click(); await flushPromises();
        expect(getElementByClass(containerEl, 'pa-chat-composer-menu').hidden).toBe(false);
        expect(getButtonByText(containerEl, 'Unfinished note saves').hidden).toBe(true);
        expect(getButtonByText(containerEl, 'New Chat').disabled).toBe(false);
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

    it('flips message action menus below when there is not enough room above', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'hello';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const assistantMessage = getElementsByClass(containerEl, 'llm-message')
            .find((el) => el.classList.contains('assistant'));
        if (!assistantMessage) throw new Error('assistant message not found');
        const actions = getElementByClass(assistantMessage, 'message-actions');
        const messageMenuButton = getButtonByClass(actions, 'message-more-button');
        const messageMenu = getElementByClass(actions, 'pa-chat-message-menu');
        getResponseDiv(view).boundingRect = {
            left: 0,
            top: 0,
            right: 320,
            bottom: 240,
            width: 320,
            height: 240,
        };
        actions.boundingRect = {
            left: 12,
            top: 6,
            right: 120,
            bottom: 40,
            width: 108,
            height: 34,
        };
        messageMenu.boundingRect = {
            left: 0,
            top: 0,
            right: 108,
            bottom: 88,
            width: 108,
            height: 88,
        };

        messageMenuButton.click();

        expect(messageMenu.hidden).toBe(false);
        expect(messageMenu.classList.contains('pa-chat-message-menu-below')).toBe(true);
    });

    it('copies finalized messages from the inline message toolbar', async () => {
        const { view, containerEl } = createView();
        const writeText = globalThis.navigator.clipboard.writeText as jest.MockedFunction<(text: string) => Promise<void>>;
        await view.onOpen();

        getTextArea(containerEl).value = 'copy prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('answer **markdown**');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const userMessage = getElementsByClass(containerEl, 'llm-message')
            .find((el) => el.classList.contains('user'));
        const assistantMessage = getElementsByClass(containerEl, 'llm-message')
            .find((el) => el.classList.contains('assistant'));
        if (!userMessage || !assistantMessage) throw new Error('messages not found');

        getButtonByClass(userMessage, 'copy-message-button').click();
        getButtonByClass(assistantMessage, 'copy-message-button').click();
        await flushPromises();

        expect(writeText).toHaveBeenNthCalledWith(1, 'copy prompt');
        expect(writeText).toHaveBeenNthCalledWith(2, 'answer **markdown**');
    });

    it('disables live assistant copy until content is available', async () => {
        const { view, containerEl } = createView();
        const writeText = globalThis.navigator.clipboard.writeText as jest.MockedFunction<(text: string) => Promise<void>>;
        await view.onOpen();

        getTextArea(containerEl).value = 'stream prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();

        const assistantMessage = getElementByClass(containerEl, 'assistant');
        const copyButton = getButtonByClass(assistantMessage, 'copy-message-button');
        expect(copyButton.disabled).toBe(true);
        copyButton.click();
        expect(writeText).not.toHaveBeenCalled();

        streamCalls[0].onChunk('partial answer');
        await flushPromises();
        await flushPromises();

        expect(copyButton.disabled).toBe(false);
        copyButton.click();
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('partial answer');
    });

    it('deletes successful turns through the message overflow menu', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'first prompt';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('first answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const assistantMessage = getElementsByClass(containerEl, 'llm-message')
            .find((el) => el.classList.contains('assistant'));
        if (!assistantMessage) throw new Error('assistant message not found');
        const messageMenuButton = getButtonByClass(assistantMessage, 'message-more-button');
        const messageMenu = getElementByClass(assistantMessage, 'pa-chat-message-menu');

        messageMenuButton.click();
        expect(messageMenu.hidden).toBe(false);
        expect(messageMenuButton.getAttribute('aria-expanded')).toBe('true');
        getButtonByClass(messageMenu, 'delete-message-button').click();
        await flushPromises();
        await flushPromises();

        expect(view.chatHistory).toEqual([]);
        expect(allText(containerEl)).not.toContain('first prompt');
        expect(allText(containerEl)).not.toContain('first answer');
    });

    it('renders completed message actions as a bottom inline toolbar', async () => {
        const { view, containerEl } = createView();
        await view.onOpen();

        getTextArea(containerEl).value = 'hello';
        void getButtonByText(containerEl, 'Ask').click();
        await flushPromises();
        streamCalls[0].onChunk('answer');
        streamCalls[0].resolve();
        await flushPromises();
        await flushPromises();

        const assistantMessage = getElementsByClass(containerEl, 'llm-message')
            .find((el) => el.classList.contains('assistant'));
        if (!assistantMessage) throw new Error('assistant message not found');
        const content = getElementByClass(assistantMessage, 'message-content');
        const actions = getElementByClass(assistantMessage, 'message-actions');
        const copyButton = getButtonByClass(actions, 'copy-message-button');
        const addButton = getButtonByClass(actions, 'add-to-editor-message-button');
        const menuButton = getButtonByClass(actions, 'message-more-button');
        const messageMenu = getElementByClass(actions, 'pa-chat-message-menu');

        expect(assistantMessage.children.indexOf(content)).toBeLessThan(assistantMessage.children.indexOf(actions));
        expect(actions.getAttribute('role')).toBe('group');
        expect(actions.getAttribute('aria-label')).toBe('Message actions');
        expect(copyButton.parentElement).toBe(actions);
        expect(copyButton.getAttribute('aria-label')).toBe('Copy message');
        expect(addButton.parentElement).toBe(actions);
        expect(addButton.getAttribute('aria-label')).toBe('Add to editor');
        expect(menuButton.parentElement).toBe(actions);
        expect(menuButton.getAttribute('aria-label')).toBe('More message actions');
        expect(menuButton.getAttribute('aria-haspopup')).toBeNull();
        expect(menuButton.hidden).toBe(false);
        expect(actions.children.indexOf(copyButton)).toBeLessThan(actions.children.indexOf(addButton));
        expect(actions.children.indexOf(addButton)).toBeLessThan(actions.children.indexOf(menuButton));
        expect(messageMenu.parentElement).toBe(actions);
        expect(messageMenu.hidden).toBe(true);
        expect(getButtonsByClass(messageMenu, 'delete-message-button')).toHaveLength(1);
        expect(getButtonsByClass(messageMenu, 'copy-message-button')).toHaveLength(0);
        expect(getButtonsByClass(messageMenu, 'add-to-editor-message-button')).toHaveLength(0);
    });

    it('keeps the Memory chip menu and More menu mutually exclusive', async () => {
        let resolvePlan: (plan: MemoryMaintenancePlan) => void = () => {};
        const pendingPlan = new Promise<MemoryMaintenancePlan>((resolve) => {
            resolvePlan = resolve;
        });
        const { view, containerEl, plugin } = createView();
        plugin.memoryStatus.getMaintenancePlan.mockReturnValue(pendingPlan);
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
        plugin.memoryStatus.getMaintenancePlan.mockResolvedValue({
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

        expect(plugin.memoryStatus.updateFromCommand).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('keeps lexical preparation actionable and refreshes its result (completed: %s)', async (completed) => {
        const { view, containerEl, plugin } = createView();
        plugin.memoryStatus.getMaintenancePlan.mockResolvedValue({
            reason: 'lexical-profile-stale',
            action: 'rebuild-lexical',
            notesToCheck: 1852,
            requiresApproval: true,
            canAnswerNow: true,
        });
        plugin.memoryStatus.prepareFromCommand.mockImplementation(async () => {
            if (completed) {
                plugin.memoryStatus.getMaintenancePlan.mockResolvedValue({
                    reason: 'ready',
                    action: 'none',
                    notesToCheck: 1852,
                    requiresApproval: false,
                    canAnswerNow: true,
                });
            }
        });
        await view.onOpen();
        await flushPromises();

        const memoryChip = getButtonByClass(containerEl, 'pa-chat-memory-chip');
        expect(memoryChip.getAttribute('aria-label')).toBe('Memory needs update');
        expect(memoryChip.classList.contains('personal-assistant-ai-statusbar-needs-update')).toBe(true);
        memoryChip.click();
        await flushPromises();

        const memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');
        expect(allText(memoryMenu)).not.toContain('Memory unavailable');
        getButtonByText(memoryMenu, 'Update Memory search').click();
        await flushPromises();

        expect(plugin.memoryStatus.prepareFromCommand).toHaveBeenCalledTimes(1);
        expect(plugin.memoryStatus.updateFromCommand).not.toHaveBeenCalled();
        expect(memoryMenu.hidden).toBe(true);
        expect(memoryChip.getAttribute('aria-label')).toBe(completed ? 'Memory ready' : 'Memory needs update');

        memoryChip.click();
        await flushPromises();
        expect(allText(memoryMenu).includes('Update Memory search')).toBe(!completed);
    });

    it('refreshes the Memory chip when background memory status changes', async () => {
        const { view, containerEl, plugin, emitMemoryStatusChanged } = createView();
        plugin.memoryStatus.getMaintenancePlan
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

    it('unsubscribes Memory and settings refresh listeners on close', async () => {
        const { view, getMemoryStatusListenerCount, getSettingsChangeListenerCount } = createView();

        await view.onOpen();
        expect(getMemoryStatusListenerCount()).toBe(1);
        expect(getSettingsChangeListenerCount()).toBe(1);

        await view.onClose();
        expect(getMemoryStatusListenerCount()).toBe(0);
        expect(getSettingsChangeListenerCount()).toBe(0);
    });

    it('keeps Memory diagnostics and settings behind menu entries', async () => {
        const { view, containerEl, plugin, app } = createView();
        await view.onOpen();
        await flushPromises();

        getButtonByClass(containerEl, 'pa-chat-memory-chip').click();
        await flushPromises();
        let memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');
        getButtonByText(memoryMenu, 'Open settings').click();
        expect(plugin.openMemorySettings).toHaveBeenCalledWith();
        expect(app.setting.open).not.toHaveBeenCalled();
        expect(app.setting.openTabById).not.toHaveBeenCalled();

        getButtonByClass(containerEl, 'pa-chat-memory-chip').click();
        await flushPromises();
        memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');
        getButtonByText(memoryMenu, 'Show Memory Status').click();
        expect(plugin.memoryStatus.showTechnicalStatus).toHaveBeenCalledTimes(1);
    });

    it('falls back to the plugin root settings when the Memory settings entry is unavailable', async () => {
        const { view, containerEl, plugin, app } = createView();
        delete (plugin as { openMemorySettings?: () => void }).openMemorySettings;
        await view.onOpen();
        await flushPromises();

        getButtonByClass(containerEl, 'pa-chat-memory-chip').click();
        await flushPromises();
        const memoryMenu = getElementByClass(containerEl, 'pa-chat-memory-menu');
        getButtonByText(memoryMenu, 'Open settings').click();

        expect(app.setting.open).toHaveBeenCalledTimes(1);
        expect(app.setting.openTabById).toHaveBeenCalledWith('personal-assistant');
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

        expect(allText(containerEl)).toContain('No related notes found');
        expect(allText(containerEl)).toContain('Checking 2 related notes...');
        expect(allText(containerEl)).toContain('Reading selected notes...');
        expect(allText(containerEl)).toContain('Context unavailable');
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
        expect(runningText).toContain('Reading tags...');

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
        expect(text).toContain('Tags');
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
        expect(text).toContain('Tags complete');
        expect(text).toContain('Context Used');
        expect(text).toContain('Tags unavailable');
        expect(text).toContain('Notes context was unavailable for this turn.');
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
        expect(text).toContain('Note structure');
        expect(text).toContain('Context already gathered');
        expect(text).toContain('Using gathered context after reaching the planning limit.');
        expect(text).toContain('Context Used');
        expect(text).toContain('Note structure');
        expect(text).not.toContain('Note structure unavailable');
        expect(text).not.toContain('Notes context was unavailable for this turn.');
        expect(text).not.toContain('Context unavailable');
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
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

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
        const { view, containerEl, tabOptions, drawerInner } = createMobileView();
        await view.onOpen();

        const handle = walk(containerEl, (el) => el.classList.contains('pa-tab-bar-handle'));
        expect(handle).not.toBeNull();
        expect(drawerInner.classList.contains('pa-chat-drawer-host')).toBe(true);
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
        expect(drawerInner.classList.contains('pa-chat-drawer-host')).toBe(false);
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
