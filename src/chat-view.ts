import { WorkspaceLeaf, MarkdownView, Notice, ItemView, MarkdownRenderer, setIcon, Modal, Setting, Component, type EventRef } from 'obsidian';
import { ChatService, type AgentEvent, type ChatAgentStatus, type ChatContextUsedItem, type ChatTurnMemoryMetadata } from './ai-services/chat-service';
import { BUNDLED_SKILL_CATALOG } from './ai-services/bundled-skill-catalog';
import { createPaAgentPersistedTurn, readChatHistoryTurnMetadata } from './ai-services/pa-agent-history';
import type { ChatRuntimeWarning, PaAgentMessage, PaAgentPersistedTurn, SourceRecord, TurnEndStatus } from './ai-services/chat-types';
import type PluginManager from "./main";
import { VSS } from './vss'
import type { MemoryMaintenancePlan } from './memory-manager';

export const VIEW_TYPE_LLM = "sidellm-view";

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    memoryMetadata?: ChatTurnMemoryMetadata;
    canonicalTurn?: PaAgentPersistedTurn;
    runtimeWarnings?: ChatRuntimeWarning[];
}

interface ThinkingStatusView {
    messageDiv: HTMLDivElement;
    summaryEl: HTMLElement;
    detailsEl: HTMLElement;
    activityListEl: HTMLElement;
    toggleButton: HTMLButtonElement;
    loaderEl?: HTMLElement;
    reasoningSectionEl?: HTMLElement;
    reasoningContentEl?: HTMLElement;
    contextUsedSectionEl?: HTMLElement;
    contextUsedListEl?: HTMLElement;
    warningSectionEl?: HTMLElement;
    warningListEl?: HTMLElement;
    expanded: boolean;
    detailItems: HTMLElement[];
    lastDetail?: string;
}

interface ChatConfirmationOptions {
    title: string;
    message: string;
    confirmText: string;
    cancelText?: string;
    danger?: boolean;
}

type MarkdownRenderOptions = {
    forceScroll?: boolean;
    deferMermaid?: boolean;
};

type MermaidFenceTransform = {
    markdown: string;
    deferred: boolean;
    sources: string[];
};

type MemoryChipState = {
    label: string;
    visualState: "ready" | "needs-update" | "needs-setup" | "unavailable";
    actionLabel?: string;
    actionKind?: "prepare" | "update";
};

const MEMORY_CHIP_STATE_CLASSES = [
    "personal-assistant-ai-statusbar-ready",
    "personal-assistant-ai-statusbar-needs-update",
    "personal-assistant-ai-statusbar-needs-setup",
    "personal-assistant-ai-statusbar-unavailable",
];
export const CHAT_MENU_IDLE_CLOSE_MS = 8000;
const KEYBOARD_FOCUS_FALLBACK_DELAY_MS = 300;

let ldrsLoadersRequested = false;
let mermaidPreviewModalId = 0;

type KeyboardPluginEventName = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardWillHide' | 'keyboardDidHide';
type KeyboardDocumentEventName = 'focusin' | 'focusout';
type KeyboardWindowEventName = KeyboardPluginEventName | 'resize' | 'orientationchange';

interface KeyboardPluginInfo {
    keyboardHeight?: number;
}

interface KeyboardPluginListenerHandle {
    remove?: () => Promise<void> | void;
}

interface KeyboardPluginFacade {
    addListener?: (
        eventName: KeyboardPluginEventName,
        listenerFunc: (info: KeyboardPluginInfo) => void,
    ) => Promise<KeyboardPluginListenerHandle> | KeyboardPluginListenerHandle;
}

function ensureChatLoadersRegistered(log?: (message: string, error?: unknown) => void): void {
    if (ldrsLoadersRequested) return;
    if (typeof document === 'undefined' || typeof globalThis.customElements === 'undefined') return;

    ldrsLoadersRequested = true;
    void Promise.all([
        import('ldrs/quantum'),
        import('ldrs/bouncyArc'),
    ]).catch((error) => {
        ldrsLoadersRequested = false;
        log?.('Could not load chat waiting animations', error);
    });
}

class ChatConfirmationModal extends Modal {
    private resolved = false;

    constructor(
        plugin: PluginManager,
        private readonly options: ChatConfirmationOptions,
        private readonly onResolve: (confirmed: boolean) => void,
    ) {
        super(plugin.app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.options.title });
        contentEl.createEl('p', { text: this.options.message });
        new Setting(contentEl)
            .addButton((button) => {
                button
                    .setButtonText(this.options.cancelText ?? 'Cancel')
                    .onClick(() => this.resolve(false));
            })
            .addButton((button) => {
                if (this.options.danger) {
                    button.setWarning();
                } else {
                    button.setCta();
                }
                button
                    .setButtonText(this.options.confirmText)
                    .onClick(() => this.resolve(true));
            });
    }

    onClose() {
        this.resolve(false);
    }

    private resolve(confirmed: boolean) {
        if (this.resolved) return;
        this.resolved = true;
        this.onResolve(confirmed);
        this.close();
    }
}

class MermaidPreviewModal extends Modal {
    private renderOwner: Component | null = null;

    constructor(
        private readonly plugin: PluginManager,
        private readonly mermaidSource: string,
    ) {
        super(plugin.app);
    }

    onOpen() {
        const { contentEl } = this;
        const titleId = `pa-chat-mermaid-modal-title-${++mermaidPreviewModalId}`;
        this.modalEl.classList.add('pa-chat-mermaid-modal-shell');
        contentEl.empty();
        contentEl.classList.add('pa-chat-mermaid-modal');
        contentEl.createEl('h2', {
            text: 'Mermaid diagram',
            attr: { id: titleId },
        });
        this.modalEl.setAttribute('aria-labelledby', titleId);
        const viewport = contentEl.createDiv({ cls: 'pa-chat-mermaid-modal-viewport' });
        this.renderOwner = new Component();
        void renderMarkdownWithOwner(
            this.plugin,
            createFencedCodeBlock('mermaid', this.mermaidSource),
            viewport,
            this.renderOwner,
        ).then(() => {
            const diagrams = Array.from(
                viewport.querySelectorAll('.mermaid, .block-language-mermaid'),
            ) as HTMLElement[];
            for (const diagram of diagrams) {
                diagram.classList.add('pa-chat-mermaid-modal-diagram');
            }
        }).catch((error) => {
            viewport.setText(`Could not render Mermaid diagram: ${String(error)}`);
        });
    }

    onClose() {
        this.renderOwner?.unload();
        this.renderOwner = null;
    }
}

function confirmChatAction(plugin: PluginManager, options: ChatConfirmationOptions): Promise<boolean> {
    if (typeof document === 'undefined') {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        new ChatConfirmationModal(plugin, options, resolve).open();
    });
}

function createChatMenuItem(
    parent: HTMLElement,
    { text, icon, cls = '' }: { text: string; icon: string; cls?: string },
): HTMLButtonElement {
    const button = parent.createEl('button', {
        cls: `pa-chat-menu-item ${cls}`.trim(),
        attr: { type: 'button' },
    });
    const iconEl = button.createSpan({ cls: 'pa-chat-menu-item-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setIcon(iconEl, icon);
    button.createSpan({ cls: 'pa-chat-menu-item-text', text });
    return button;
}

function createChatMenuDivider(parent: HTMLElement) {
    parent.createDiv({ cls: 'pa-chat-menu-divider' });
}

function createChatMenuLabel(parent: HTMLElement, text: string, icon: string) {
    const label = parent.createDiv({ cls: 'pa-chat-menu-label' });
    const iconEl = label.createSpan({ cls: 'pa-chat-menu-label-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setIcon(iconEl, icon);
    label.createSpan({ cls: 'pa-chat-menu-label-text', text });
    return label;
}

function renderMarkdownWithOwner(
    plugin: PluginManager,
    markdown: string,
    target: HTMLElement,
    owner: Component,
): Promise<void> {
    try {
        return Promise.resolve(MarkdownRenderer.render(plugin.app, markdown, target, '', owner));
    } catch (error) {
        return Promise.reject(error);
    }
}

function createFencedCodeBlock(language: string, source: string): string {
    const fence = source.includes('```') ? '~~~~' : '```';
    const normalizedSource = source.endsWith('\n') ? source : `${source}\n`;
    return `${fence}${language}\n${normalizedSource}${fence}`;
}

function transformMermaidFences(markdown: string, defer: boolean): MermaidFenceTransform {
    const lines = markdown.match(/[^\n]*(?:\n|$)/g)?.filter((line, index, all) =>
        index < all.length - 1 || line.length > 0
    ) ?? [];
    const output: string[] = [];
    const sources: string[] = [];
    let deferred = false;
    let activeFence: {
        marker: '`' | '~';
        length: number;
        mermaid: boolean;
        sourceLines: string[];
    } | null = null;

    for (const rawLine of lines) {
        const newlineMatch = rawLine.match(/(\r?\n)$/);
        const newline = newlineMatch?.[1] ?? '';
        const line = newline ? rawLine.slice(0, -newline.length) : rawLine;

        if (activeFence) {
            const close = parseFenceClose(line);
            if (
                close
                && close.marker === activeFence.marker
                && close.length >= activeFence.length
            ) {
                if (activeFence.mermaid) {
                    sources.push(activeFence.sourceLines.join(''));
                }
                activeFence = null;
                output.push(rawLine);
                continue;
            }

            if (activeFence.mermaid) {
                activeFence.sourceLines.push(rawLine);
            }
            output.push(rawLine);
            continue;
        }

        const open = parseFenceOpen(line);
        if (!open) {
            output.push(rawLine);
            continue;
        }

        const language = open.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        const mermaid = language === 'mermaid';
        activeFence = {
            marker: open.marker,
            length: open.length,
            mermaid,
            sourceLines: [],
        };

        if (mermaid && defer) {
            deferred = true;
            output.push(`${open.prefix}${open.fence}${open.spacing}${open.info.replace(/^mermaid\b/i, 'text')}${newline}`);
        } else {
            output.push(rawLine);
        }
    }

    return {
        markdown: output.join(''),
        deferred,
        sources,
    };
}

function containsMermaidFence(markdown: string): boolean {
    return transformMermaidFences(markdown, true).deferred;
}

function deferMermaidFences(markdown: string): MermaidFenceTransform {
    return transformMermaidFences(markdown, true);
}

function getMermaidFenceSources(markdown: string): string[] {
    return transformMermaidFences(markdown, false).sources;
}

function parseFenceOpen(line: string): {
    prefix: string;
    fence: string;
    marker: '`' | '~';
    length: number;
    spacing: string;
    info: string;
} | null {
    const match = line.match(/^((?:[ \t]{0,3}>[ \t]?)*[ \t]{0,3})(`{3,}|~{3,})([ \t]*)([^\r\n]*)$/);
    if (!match) return null;
    const fence = match[2];
    return {
        prefix: match[1],
        fence,
        marker: fence[0] as '`' | '~',
        length: fence.length,
        spacing: match[3],
        info: match[4],
    };
}

function parseFenceClose(line: string): { marker: '`' | '~'; length: number } | null {
    const match = line.match(/^(?:[ \t]{0,3}>[ \t]?)*[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
    if (!match) return null;
    return {
        marker: match[1][0] as '`' | '~',
        length: match[1].length,
    };
}

function hasAncestorWithClass(element: HTMLElement, className: string): boolean {
    let current = element.parentElement;
    while (current) {
        if (current.classList.contains(className)) return true;
        current = current.parentElement;
    }
    return false;
}

function isMermaidDiagramCandidate(element: HTMLElement): boolean {
    return element.classList.contains('mermaid') || element.classList.contains('block-language-mermaid');
}

function hasAncestorMermaidDiagramCandidate(element: HTMLElement, root: HTMLElement): boolean {
    let current = element.parentElement;
    while (current && current !== root) {
        if (isMermaidDiagramCandidate(current)) return true;
        current = current.parentElement;
    }
    return false;
}

function getTopLevelMermaidDiagramCandidates(root: HTMLElement): HTMLElement[] {
    return (Array.from(
        root.querySelectorAll('.mermaid, .block-language-mermaid'),
    ) as HTMLElement[]).filter((diagram) => !hasAncestorMermaidDiagramCandidate(diagram, root));
}

function nodeContainsMermaidDiagramCandidate(node: Node): boolean {
    const element = node as HTMLElement;
    if (!element?.classList) return false;
    if (isMermaidDiagramCandidate(element)) return true;
    return typeof element.querySelectorAll === 'function'
        && element.querySelectorAll('.mermaid, .block-language-mermaid').length > 0;
}

function mutationMayAffectMermaidDiagrams(records: MutationRecord[]): boolean {
    return records.some((record) => {
        if (record.type === 'attributes') {
            return nodeContainsMermaidDiagramCandidate(record.target);
        }
        if (record.type !== 'childList') return false;
        return Array.from(record.addedNodes).some(nodeContainsMermaidDiagramCandidate);
    });
}

function createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] | null {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    return document.createElement(tagName);
}

function renderMermaidSourceWarning(buffer: HTMLElement) {
    buffer.createDiv({
        cls: 'pa-chat-render-warning',
        text: 'Mermaid diagram could not be rendered; showing source.',
    });
}

function enhanceMermaidDiagrams(root: HTMLElement, plugin: PluginManager, mermaidSources: string[]): boolean {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return true;

    const diagrams = getTopLevelMermaidDiagramCandidates(root);
    const expectedCount = mermaidSources.filter((source) => source.trim()).length;
    if (expectedCount > 1 && diagrams.length < expectedCount) {
        // Source-specific preview buttons are positional, so wait until all rendered
        // Mermaid candidates are present before binding sources to buttons.
        return false;
    }

    let sourceIndex = 0;
    diagrams.forEach((diagram) => {
        sourceIndex += 1;
        const mermaidSource = mermaidSources[sourceIndex - 1];
        if (!diagram.parentElement || hasAncestorWithClass(diagram, 'pa-chat-mermaid-shell')) return;
        if (!mermaidSource?.trim()) return;

        const shell = createElement('div');
        const toolbar = createElement('div');
        const viewport = createElement('div');
        const button = createElement('button');
        const label = createElement('span');
        if (!shell || !toolbar || !viewport || !button || !label) return;

        shell.classList.add('pa-chat-mermaid-shell');
        toolbar.classList.add('pa-chat-mermaid-toolbar');
        viewport.classList.add('pa-chat-mermaid-viewport');
        button.classList.add('pa-chat-mermaid-open-button');
        button.type = 'button';
        button.setAttribute('aria-label', 'Open Mermaid diagram');
        button.setAttribute('title', 'Open Mermaid diagram');
        setIcon(button, 'zoom-in');
        label.classList.add('pa-sr-only');
        label.textContent = 'Open Mermaid diagram';
        button.appendChild(label);
        button.onclick = () => {
            new MermaidPreviewModal(plugin, mermaidSource).open();
        };

        diagram.parentElement.insertBefore(shell, diagram);
        viewport.appendChild(diagram);
        toolbar.appendChild(button);
        shell.appendChild(toolbar);
        shell.appendChild(viewport);
    });

    return expectedCount === 0
        || root.querySelectorAll('.pa-chat-mermaid-shell').length >= expectedCount;
}

function scheduleMermaidEnhancement(
    root: HTMLElement,
    plugin: PluginManager,
    mermaidSources: string[],
    isCurrent: () => boolean,
    owner?: Component,
) {
    if (mermaidSources.length === 0) return;

    let stopped = false;
    let observer: MutationObserver | null = null;
    let fallbackFrameCount = 0;
    let fallbackFrameId: number | null = null;
    let observerFrameId: number | null = null;
    let timeoutId: number | null = null;

    const stop = () => {
        stopped = true;
        observer?.disconnect();
        observer = null;
        if (
            fallbackFrameId !== null
            && typeof window !== 'undefined'
            && typeof window.cancelAnimationFrame === 'function'
        ) {
            window.cancelAnimationFrame(fallbackFrameId);
        }
        fallbackFrameId = null;
        if (
            observerFrameId !== null
            && typeof window !== 'undefined'
            && typeof window.cancelAnimationFrame === 'function'
        ) {
            window.cancelAnimationFrame(observerFrameId);
        }
        observerFrameId = null;
        if (
            timeoutId !== null
            && typeof window !== 'undefined'
            && typeof window.clearTimeout === 'function'
        ) {
            window.clearTimeout(timeoutId);
        }
        timeoutId = null;
    };

    owner?.register(stop);

    const enhanceIfCurrent = (): boolean => {
        if (stopped) return true;
        if (!isCurrent()) {
            stop();
            return true;
        }
        const complete = enhanceMermaidDiagrams(root, plugin, mermaidSources);
        if (complete) stop();
        return complete;
    };

    const scheduleObservedEnhancement = () => {
        if (stopped || observerFrameId !== null) return;
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            observerFrameId = window.requestAnimationFrame(() => {
                observerFrameId = null;
                enhanceIfCurrent();
            });
            return;
        }
        enhanceIfCurrent();
    };

    if (enhanceIfCurrent()) return;

    if (typeof MutationObserver === 'function') {
        observer = new MutationObserver((records) => {
            if (!mutationMayAffectMermaidDiagrams(records)) return;
            scheduleObservedEnhancement();
        });
        observer.observe(root, {
            attributes: true,
            attributeFilter: ['class'],
            childList: true,
            subtree: true,
        });
    } else if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        const retryWithAnimationFrame = () => {
            fallbackFrameCount += 1;
            if (enhanceIfCurrent() || fallbackFrameCount >= 60) {
                stop();
                return;
            }
            fallbackFrameId = window.requestAnimationFrame(retryWithAnimationFrame);
        };
        fallbackFrameId = window.requestAnimationFrame(retryWithAnimationFrame);
    }

    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        timeoutId = window.setTimeout(stop, 15000);
    }
}

export class LLMView extends ItemView {
    plugin: PluginManager;
    result: string = '';
    responseDiv!: HTMLDivElement;
    abortController: AbortController | null = null;
    chatHistory: ChatMessage[] = [];
    vss: VSS;
    private chatService: ChatService;
    private viewSessionId = 0;
    private activeTurnId = 0;
    private activeTurnCancelled = false;
    private scheduledScrollFrame: number | null = null;
    private panelResizeObserver: ResizeObserver | null = null;
    private statusBarResizeObserver: ResizeObserver | null = null;
    private statusBarResizeHandler: (() => void) | null = null;
    private keyboardVisualViewport: VisualViewport | null = null;
    private keyboardUpdateHandler: (() => void) | null = null;
    private keyboardUpdateFrame: number | null = null;
    private keyboardWindowListeners: Array<{ type: KeyboardWindowEventName; listener: EventListener }> = [];
    private keyboardDocumentListeners: Array<{ type: KeyboardDocumentEventName; listener: EventListener }> = [];
    private keyboardPluginListenerHandles: KeyboardPluginListenerHandle[] = [];
    private keyboardFocusFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    private keyboardFocusFallbackToken = 0;
    private keyboardFocusFallbackElement: HTMLElement | null = null;
    private nativeKeyboardHeight = 0;
    private focusFallbackKeyboardHeight = 0;
    private memoryStatusUnsubscribe: (() => void) | null = null;
    private markdownRenderOwners = new Set<Component>();

    constructor(leaf: WorkspaceLeaf, plugin: PluginManager, vss: VSS) {
        super(leaf);
        this.plugin = plugin;
        this.vss = vss;
        this.chatService = new ChatService(plugin);
    }

    private createMarkdownRenderOwner(): Component {
        const owner = new Component();
        this.markdownRenderOwners.add(owner);
        return owner;
    }

    private unloadMarkdownRenderOwner(owner?: Component | null) {
        if (!owner || !this.markdownRenderOwners.delete(owner)) return;
        owner.unload();
    }

    private unloadAllMarkdownRenderOwners() {
        for (const owner of this.markdownRenderOwners) {
            owner.unload();
        }
        this.markdownRenderOwners.clear();
    }

    getViewType(): string {
        return VIEW_TYPE_LLM;
    }

    getDisplayText(): string {
        return "Personal Assistant Chat";
    }

    getIcon(): string {
        return "bot-message-square";
    }

    async onOpen() {
        const sessionId = this.startViewSession();
        ensureChatLoadersRegistered((message, error) => this.plugin.log(message, error));
        const { containerEl } = this;
        containerEl.empty();
        containerEl.classList.add('llm-view');
        this.observePanelDensity(containerEl);
        this.observeStatusBarClearance(containerEl);

        const chatContainer = containerEl.createDiv({ cls: 'llm-chat-container' });

        const inputDiv = containerEl.createDiv({ cls: 'llm-input' });
        const composerRow = inputDiv.createDiv({ cls: 'pa-chat-composer-row' });
        const textArea = composerRow.createEl('textarea', {
            attr: { rows: '3', placeholder: 'Ask about your notes...' }
        });
        const skillTypeahead = inputDiv.createDiv({
            cls: 'pa-chat-skill-typeahead',
            attr: {
                role: 'listbox',
                'aria-label': 'Skill guides',
            },
        });
        skillTypeahead.hidden = true;

        textArea.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !skillTypeahead.hidden) {
                e.preventDefault();
                hideSkillTypeahead();
                return;
            }
            if (e.key !== 'Enter' || e.shiftKey) return;
            if (isGenerating()) {
                e.preventDefault();
                showComposerHint('Wait for this answer to finish or stop it first.');
                return;
            }
            if (textArea.value.trim()) {
                e.preventDefault();
                sendButton.click();
            }
        });
        textArea.addEventListener('input', () => {
            hideComposerHint();
            renderSkillTypeahead();
            syncComposerControls();
        });
        composerRow.addEventListener('click', (event) => {
            if (event.defaultPrevented) return;
            if (!this.shouldFocusComposerTextArea(event.target, composerRow, textArea)) return;
            textArea.focus();
        });

        const buttonDiv = composerRow.createDiv({ cls: 'llm-buttons pa-chat-composer-actions' });
        const sendButton = buttonDiv.createEl('button', {
            text: 'Ask',
            cls: 'pa-chat-icon-button send-button-visible',
            attr: {
                type: 'button',
                'aria-label': 'Ask',
                title: 'Ask',
            },
        });
        setIcon(sendButton, 'send');
        sendButton.createSpan({ cls: 'pa-sr-only', text: 'Ask' });
        const memoryControl = buttonDiv.createSpan({ cls: 'pa-chat-memory-control' });
        const memoryChip = memoryControl.createEl('button', {
            cls: 'pa-chat-icon-button pa-chat-memory-chip personal-assistant-ai-statusbar',
            attr: {
                type: 'button',
                'aria-label': 'Show Memory status',
                title: 'Show Memory status',
            },
        });
        setIcon(memoryChip, 'brain');
        const memoryChipLabel = memoryChip.createSpan({ cls: 'pa-sr-only', text: 'Memory' });
        const memoryMenu = memoryControl.createDiv({ cls: 'pa-chat-menu pa-chat-memory-menu' });
        const memoryMenuId = `pa-chat-memory-menu-${sessionId}`;
        memoryMenu.id = memoryMenuId;
        memoryMenu.hidden = true;
        memoryChip.setAttribute('aria-controls', memoryMenuId);
        memoryChip.setAttribute('aria-expanded', 'false');
        const cancelButton = buttonDiv.createEl('button', {
            cls: 'pa-chat-icon-button cancel-button',
            attr: {
                type: 'button',
                'aria-label': 'Stop generation',
                title: 'Stop generation',
            },
        });
        setIcon(cancelButton, 'square');
        cancelButton.createSpan({ cls: 'pa-sr-only', text: 'Stop generation' });
        cancelButton.classList.add('cancel-button-hidden');
        const moreControl = buttonDiv.createSpan({ cls: 'pa-chat-more-control' });
        const moreButton = moreControl.createEl('button', {
            cls: 'pa-chat-icon-button pa-chat-more-button',
            attr: {
                type: 'button',
                'aria-label': 'More chat actions',
                title: 'More chat actions',
                'aria-expanded': 'false',
            },
        });
        setIcon(moreButton, 'ellipsis');
        moreButton.createSpan({ cls: 'pa-sr-only', text: 'More chat actions' });
        const composerMenu = moreControl.createDiv({ cls: 'pa-chat-menu pa-chat-composer-menu' });
        composerMenu.hidden = true;
        const copyConversationButton = createChatMenuItem(composerMenu, {
            text: 'Copy conversation',
            icon: 'copy',
        });
        createChatMenuDivider(composerMenu);
        const technicalMemoryButton = createChatMenuItem(composerMenu, {
            text: 'Show Memory Status',
            icon: 'activity',
        });
        const settingsButton = createChatMenuItem(composerMenu, {
            text: 'Open settings',
            icon: 'settings',
        });
        createChatMenuDivider(composerMenu);
        const clearButton = createChatMenuItem(composerMenu, {
            text: 'Clear Chat',
            icon: 'trash-2',
            cls: 'pa-chat-menu-item-danger',
        });

        const composerHint = inputDiv.createDiv({ cls: 'pa-chat-composer-hint' });
        composerHint.hidden = true;
        composerHint.setAttribute('aria-live', 'polite');

        sendButton.disabled = true;

        this.responseDiv = chatContainer;

        const AUTO_SCROLL_THRESHOLD_PX = 80;
        let shouldAutoScroll = true;

        const isNearBottom = () => {
            const distanceFromBottom = this.responseDiv.scrollHeight
                - this.responseDiv.scrollTop
                - this.responseDiv.clientHeight;
            return distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
        };

        const scrollToBottom = (
            { force = false, behavior = 'smooth' }: { force?: boolean; behavior?: ScrollBehavior } = {}
        ) => {
            if (force) {
                shouldAutoScroll = true;
            } else if (!shouldAutoScroll) {
                return;
            }

            if (this.scheduledScrollFrame !== null) {
                window.cancelAnimationFrame(this.scheduledScrollFrame);
            }

            const frameId = window.requestAnimationFrame(() => {
                if (this.scheduledScrollFrame !== frameId) return;
                this.scheduledScrollFrame = null;
                this.responseDiv.scrollTo({
                    top: this.responseDiv.scrollHeight,
                    behavior,
                });
            });
            this.scheduledScrollFrame = frameId;
        };
        this.observeKeyboardClearance(containerEl, inputDiv, () => {
            scrollToBottom({ behavior: 'auto' });
        });

        const pauseAutoScroll = () => {
            shouldAutoScroll = false;
        };

        this.responseDiv.addEventListener('scroll', () => {
            // Resume auto-scroll whenever the viewport returns to the bottom,
            // regardless of whether the user used wheel, keyboard, touch, or the scrollbar.
            shouldAutoScroll = isNearBottom();
        });

        type RenderedMessage = {
            messageDiv: HTMLDivElement;
            roleEl: HTMLElement;
            loaderEl?: HTMLElement;
            contentDiv: HTMLElement;
            actionMenu: HTMLDivElement;
            addMessageButton?: HTMLButtonElement;
            deleteButton?: HTMLButtonElement;
            renderToken: number;
            copyContent: string;
            renderOwner?: Component;
            renderedContent?: string;
            renderedContentMode?: 'full' | 'deferred-mermaid';
            memoryMetadata?: ChatTurnMemoryMetadata;
            canonicalTurn?: PaAgentPersistedTurn;
        };
        type RuntimeWarningViewItem = ChatRuntimeWarning;
        type CanonicalLifecycleUiState = {
            active: boolean;
            runId?: string;
            finalTurnId?: string;
            currentTurnId?: string;
            messages: PaAgentMessage[];
            messagesById: Map<string, PaAgentMessage>;
            turnStatuses: Map<string, string>;
            hostContextUsedItems: ChatContextUsedItem[];
            hostSourceRecords: SourceRecord[];
            sawToolCallInAssistantMessage: boolean;
            pendingAnswerReclassified: boolean;
            warnings: RuntimeWarningViewItem[];
            terminalStatus?: string;
        };
        type UiTurn = {
            id: number;
            prompt: string;
            memoryMetadata?: ChatTurnMemoryMetadata;
            contextUsedItems: ChatContextUsedItem[];
            activityDetails: string[];
            canonicalLifecycle: CanonicalLifecycleUiState;
            userMessage?: RenderedMessage;
            assistantMessage?: RenderedMessage;
            statusView?: ThinkingStatusView;
            terminalRow?: HTMLDivElement;
            providerReasoningObserved?: boolean;
        };
        type HistoryTurnEntry = {
            kind: 'history';
            user: ChatMessage;
            assistant: ChatMessage;
            memoryMetadata?: ChatTurnMemoryMetadata;
            contextUsedItems?: ChatContextUsedItem[];
            activityDetails?: string[];
            providerReasoningObserved?: boolean;
        };
        type TerminalTurnEntry = {
            kind: 'terminal';
            id: number;
            prompt: string;
            content: string;
            terminalKind: 'error' | 'cancelled';
            errorDetail?: string;
            userMessage?: RenderedMessage;
            statusView?: ThinkingStatusView;
            terminalRow?: HTMLDivElement;
        };
        type TimelineEntry = HistoryTurnEntry | TerminalTurnEntry;

        let uiTurnId = 0;
        let thinkingStatusId = 0;
        let historyDeleteButtons: HTMLButtonElement[] = [];
        let timelineEntries: TimelineEntry[] = [];
        let emptyStateEl: HTMLElement | null = null;
        let isStopping = false;

        const isGenerating = () => this.abortController !== null;
        const createCanonicalLifecycleState = (): CanonicalLifecycleUiState => ({
            active: false,
            messages: [],
            messagesById: new Map(),
            turnStatuses: new Map(),
            hostContextUsedItems: [],
            hostSourceRecords: [],
            sawToolCallInAssistantMessage: false,
            pendingAnswerReclassified: false,
            warnings: [],
        });
        const hideComposerHint = () => {
            composerHint.empty();
            composerHint.hidden = true;
        };
        const showComposerHint = (message: string) => {
            composerHint.setText(message);
            composerHint.hidden = false;
        };
        const hideSkillTypeahead = () => {
            skillTypeahead.empty();
            skillTypeahead.hidden = true;
        };
        const getEnabledSkillTypeaheadEntries = () => {
            if (this.plugin.settings?.skillContextEnabled === false) return [];
            const enabledSkillIds = new Set(
                Array.isArray(this.plugin.settings?.enabledSkillIds)
                    ? this.plugin.settings.enabledSkillIds
                    : BUNDLED_SKILL_CATALOG.map((skill) => skill.id),
            );
            return BUNDLED_SKILL_CATALOG.filter((skill) => enabledSkillIds.has(skill.id));
        };
        const getSkillTriggerMatch = () => {
            const value = textArea.value;
            return /(?:^|\s)#([a-z0-9-]*)$/i.exec(value);
        };
        const renderSkillTypeahead = () => {
            const match = getSkillTriggerMatch();
            if (!match) {
                hideSkillTypeahead();
                return;
            }
            const query = match[1].toLowerCase();
            const entries = getEnabledSkillTypeaheadEntries()
                .filter((skill) =>
                    skill.id.includes(query)
                    || skill.label.toLowerCase().includes(query)
                    || skill.description.toLowerCase().includes(query))
                .slice(0, 7);
            skillTypeahead.empty();
            if (entries.length === 0) {
                skillTypeahead.hidden = true;
                return;
            }
            for (const skill of entries) {
                const button = skillTypeahead.createEl('button', {
                    cls: 'pa-chat-skill-typeahead-item',
                    attr: {
                        type: 'button',
                        role: 'option',
                        'data-skill-id': skill.id,
                        title: skill.description,
                    },
                });
                button.createSpan({ cls: 'pa-chat-skill-typeahead-name', text: skill.label });
                button.createSpan({ cls: 'pa-chat-skill-typeahead-id', text: `#${skill.id}` });
                button.onclick = () => {
                    const currentValue = textArea.value;
                    const currentMatch = getSkillTriggerMatch();
                    if (!currentMatch || typeof currentMatch.index !== 'number') return;
                    const triggerStart = currentValue.lastIndexOf('#');
                    textArea.value = `${currentValue.slice(0, triggerStart)}#${skill.id} `;
                    hideSkillTypeahead();
                    syncComposerControls();
                    textArea.focus();
                };
            }
            skillTypeahead.hidden = false;
        };
        const createIdleMenuAutoClose = (
            menu: HTMLElement,
            toggleButton: HTMLElement,
            closeMenu: () => void,
        ) => {
            let idleTimer: ReturnType<typeof setTimeout> | null = null;
            const clear = () => {
                if (idleTimer === null) return;
                clearTimeout(idleTimer);
                idleTimer = null;
            };
            const schedule = () => {
                clear();
                if (menu.hidden) return;
                idleTimer = setTimeout(() => {
                    idleTimer = null;
                    if (!isCurrentSession()) return;
                    closeMenu();
                }, CHAT_MENU_IDLE_CLOSE_MS);
                (idleTimer as unknown as { unref?: () => void }).unref?.();
            };
            const close = () => {
                clear();
                closeMenu();
            };
            const refresh = () => {
                if (!menu.hidden) schedule();
            };
            const idleEvents = ['mousemove', 'focusin', 'keydown', 'click'];
            for (const element of [menu, toggleButton]) {
                for (const eventName of idleEvents) {
                    element.addEventListener(eventName, refresh);
                }
            }
            return { clear, close, schedule };
        };
        const syncComposerControls = () => {
            const generating = isGenerating();
            const hasDraft = textArea.value.trim().length > 0;
            sendButton.disabled = generating || !hasDraft;
            if (generating && !isStopping) {
                textArea.setAttribute('placeholder', 'Draft next message');
                sendButton.classList.replace('send-button-visible', 'send-button-hidden');
                cancelButton.classList.replace('cancel-button-hidden', 'cancel-button-visible');
            } else {
                textArea.setAttribute('placeholder', generating ? 'Draft next message' : 'Ask about your notes...');
                sendButton.classList.replace('send-button-hidden', 'send-button-visible');
                cancelButton.classList.replace('cancel-button-visible', 'cancel-button-hidden');
            }
        };
        const setHistoryDeleteButtonsDisabled = (disabled: boolean) => {
            historyDeleteButtons.forEach((button) => {
                button.disabled = disabled;
            });
        };
        const removeElement = (element?: HTMLElement | null) => {
            if (element?.parentElement) {
                element.parentElement.removeChild(element);
            }
        };
        const createRoleLoader = (
            parent: HTMLElement,
            kind: 'thinking' | 'assistant',
        ): HTMLElement => {
            const wrapper = parent.createSpan({
                cls: `pa-chat-role-loader pa-chat-role-loader-${kind}`,
                attr: { 'aria-hidden': 'true' },
            });
            const tagName = kind === 'thinking' ? 'l-quantum' : 'l-bouncy-arc';
            wrapper.createEl(tagName as keyof HTMLElementTagNameMap, {
                cls: 'pa-chat-role-loader-element',
                attr: {
                    size: kind === 'thinking' ? '16' : '24',
                    speed: kind === 'thinking' ? '1.75' : '1.65',
                    color: 'currentColor',
                },
            });
            const fallback = wrapper.createSpan({ cls: 'pa-chat-role-loader-fallback' });
            fallback.createSpan({ text: '' });
            fallback.createSpan({ text: '' });
            fallback.createSpan({ text: '' });
            return wrapper;
        };
        const createRoleLabel = (
            parent: HTMLElement,
            text: string,
            options: {
                extraClass?: string;
                loader?: 'thinking' | 'assistant';
            } = {},
        ): { roleEl: HTMLElement; loaderEl?: HTMLElement } => {
            const roleEl = parent.createDiv({
                cls: ['message-role', options.extraClass ?? ''].filter(Boolean).join(' '),
            });
            const loaderEl = options.loader ? createRoleLoader(roleEl, options.loader) : undefined;
            roleEl.createSpan({ cls: 'pa-chat-role-text', text });
            return { roleEl, loaderEl };
        };
        const stopThinkingLoader = (statusView?: ThinkingStatusView) => {
            removeElement(statusView?.loaderEl);
            statusView?.messageDiv.removeAttribute?.('aria-busy');
            if (statusView) {
                statusView.loaderEl = undefined;
            }
        };
        const isCurrentSession = () => this.viewSessionId === sessionId;
        const isMarkdownNoteAvailable = () => {
            const workspace = this.app.workspace as {
                getActiveFile?: () => { path?: string; extension?: string } | null;
                getActiveViewOfType?: <T>(type: new (...args: never[]) => T) => T | null;
                getMostRecentLeaf?: () => WorkspaceLeaf | null;
                getLeavesOfType?: (type: string) => WorkspaceLeaf[];
            };
            const activeFile = workspace.getActiveFile?.();
            if (activeFile?.extension === 'md' || activeFile?.path?.endsWith('.md')) return true;

            if (workspace.getActiveViewOfType?.(MarkdownView)) return true;

            const isMarkdownLeaf = (leaf?: WorkspaceLeaf | null) => {
                const view = leaf?.view as (WorkspaceLeaf['view'] & {
                    file?: { path?: string; extension?: string } | null;
                    getViewType?: () => string;
                }) | undefined;
                return view instanceof MarkdownView
                    || view?.getViewType?.() === 'markdown'
                    || view?.file?.extension === 'md'
                    || Boolean(view?.file?.path?.endsWith('.md'));
            };
            const mostRecentLeaf = workspace.getMostRecentLeaf?.();
            if (isMarkdownLeaf(mostRecentLeaf)) return true;
            return Boolean(workspace.getLeavesOfType?.('markdown')?.some(isMarkdownLeaf));
        };
        const fillComposer = (prompt: string) => {
            textArea.value = prompt;
            hideComposerHint();
            syncComposerControls();
            textArea.focus();
        };
        const getMemoryChipState = (plan?: MemoryMaintenancePlan | null): MemoryChipState => {
            if (this.plugin.settings?.memoryEnabled === false) {
                return { label: 'Memory unavailable', visualState: 'unavailable' };
            }
            if (!plan) {
                return { label: 'Memory', visualState: 'unavailable' };
            }
            if (plan.reason === 'ready') {
                return { label: 'Memory ready', visualState: 'ready' };
            }
            if (plan.reason === 'changed-notes') {
                return {
                    label: 'Memory needs update',
                    visualState: 'needs-update',
                    actionLabel: 'Update memory',
                    actionKind: 'update',
                };
            }
            if (plan.reason === 'settings-changed') {
                return {
                    label: 'Memory needs update',
                    visualState: 'needs-update',
                    actionLabel: 'Prepare memory',
                    actionKind: 'prepare',
                };
            }
            if (plan.reason === 'first-use' || plan.reason === 'local-memory-missing') {
                return {
                    label: 'Memory needs setup',
                    visualState: 'needs-setup',
                    actionLabel: 'Prepare memory',
                    actionKind: 'prepare',
                };
            }
            return { label: 'Memory unavailable', visualState: 'unavailable' };
        };
        const setMemoryChipState = (state: MemoryChipState) => {
            memoryChipLabel.setText(state.label);
            memoryChip.setAttribute('aria-label', state.label);
            memoryChip.setAttribute('title', state.label);
            memoryChip.classList.remove(...MEMORY_CHIP_STATE_CLASSES);
            memoryChip.classList.add(`personal-assistant-ai-statusbar-${state.visualState}`);
        };
        const readMemoryPlan = async (): Promise<MemoryMaintenancePlan | null> => {
            try {
                return await this.plugin.memoryManager?.getMaintenancePlan?.() ?? null;
            } catch (error) {
                this.plugin.log?.("Could not read Memory state for chat chip", error);
                return { reason: 'unavailable', action: 'none', notesToCheck: 0, requiresApproval: false, canAnswerNow: true };
            }
        };
        const refreshMemoryChipState = async () => {
            setMemoryChipState(getMemoryChipState(await readMemoryPlan()));
        };
        let memoryMenuRequestId = 0;
        const closeMemoryMenu = () => {
            memoryMenuRequestId += 1;
            memoryMenu.hidden = true;
            memoryChip.setAttribute('aria-expanded', 'false');
        };
        const renderMemoryMenu = async () => {
            memoryMenu.empty();
            const state = getMemoryChipState(await readMemoryPlan());
            setMemoryChipState(state);
            createChatMenuLabel(memoryMenu, state.label, 'brain');
            if (state.actionLabel && state.actionKind) {
                const actionButton = createChatMenuItem(memoryMenu, {
                    text: state.actionLabel,
                    icon: state.actionKind === 'update' ? 'refresh-cw' : 'sparkles',
                    cls: 'pa-chat-memory-action',
                });
                actionButton.onclick = () => {
                    closeMemoryMenu();
                    if (state.actionKind === 'update') {
                        void this.plugin.memoryManager?.updateFromCommand?.().then(refreshMemoryChipState);
                    } else {
                        void this.plugin.memoryManager?.prepareFromCommand?.().then(refreshMemoryChipState);
                    }
                };
            }
            createChatMenuDivider(memoryMenu);
            const openSettingsButton = createChatMenuItem(memoryMenu, {
                text: 'Open settings',
                icon: 'settings',
            });
            openSettingsButton.onclick = () => {
                closeMemoryMenu();
                const appWithSettings = this.app as typeof this.app & {
                    setting?: {
                        open: () => void;
                        openTabById: (id: string) => void;
                    };
                };
                appWithSettings.setting?.open();
                appWithSettings.setting?.openTabById('personal-assistant');
            };
            const technicalButton = createChatMenuItem(memoryMenu, {
                text: 'Show Memory Status',
                icon: 'activity',
            });
            technicalButton.onclick = () => {
                closeMemoryMenu();
                void this.plugin.showTechnicalMemoryStatus?.();
            };
        };
        const renderEmptyState = () => {
            removeElement(emptyStateEl);
            emptyStateEl = null;
            if (timelineEntries.length > 0 || isGenerating()) return;

            const hasNote = isMarkdownNoteAvailable();
            emptyStateEl = this.responseDiv.createDiv({ cls: 'pa-chat-empty-state' });
            emptyStateEl.createDiv({ cls: 'pa-chat-empty-title', text: 'Ask about your notes' });
            const chips = emptyStateEl.createDiv({ cls: 'pa-chat-empty-chips' });
            const chipSpecs = [
                { label: 'Summarize current note', prompt: 'Summarize the current note.' },
                { label: 'Find related notes', prompt: 'Find notes related to the current note.' },
                { label: 'Draft from current note', prompt: 'Draft a concise response based on the current note.' },
            ];
            chipSpecs.forEach((spec) => {
                const chip = chips.createEl('button', {
                    text: spec.label,
                    cls: 'pa-chat-empty-chip',
                    attr: { type: 'button' },
                });
                chip.disabled = !hasNote;
                chip.onclick = () => {
                    if (chip.disabled) {
                        showComposerHint('Open a note to use this.');
                        return;
                    }
                    fillComposer(spec.prompt);
                };
            });
            if (!hasNote) {
                emptyStateEl.createDiv({ cls: 'pa-chat-empty-hint', text: 'Open a note to use this.' });
            }
        };
        const refreshEmptyStateForWorkspace = () => {
            if (!isCurrentSession() || !emptyStateEl) return;
            renderEmptyState();
        };
        const workspaceWithEvents = this.app.workspace as typeof this.app.workspace & {
            on?: (name: 'active-leaf-change' | 'file-open', callback: () => void) => EventRef;
        };
        if (typeof workspaceWithEvents.on === 'function') {
            this.registerEvent(workspaceWithEvents.on('active-leaf-change', refreshEmptyStateForWorkspace));
            this.registerEvent(workspaceWithEvents.on('file-open', refreshEmptyStateForWorkspace));
        }
        const createRenderBuffer = (): HTMLElement => {
            if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
                return document.createElement('div');
            }
            return renderedFallbackBuffer();
        };
        const renderedFallbackBuffer = (): HTMLElement => {
            return this.responseDiv.createDiv({ cls: 'message-render-buffer-detached-fallback' }) as HTMLElement;
        };
        const renderMarkdownInto = (
            rendered: RenderedMessage,
            content: string,
            isLive: () => boolean,
            options: MarkdownRenderOptions = {},
        ): Promise<boolean> => {
            rendered.renderToken += 1;
            rendered.copyContent = content;
            const renderToken = rendered.renderToken;
            const buffer = createRenderBuffer();
            buffer.classList.add('message-render-buffer');
            const mermaidTransform = options.deferMermaid
                ? deferMermaidFences(content)
                : { markdown: content, deferred: false, sources: getMermaidFenceSources(content) };
            const renderOwner = this.createMarkdownRenderOwner();

            return renderMarkdownWithOwner(this.plugin, mermaidTransform.markdown, buffer, renderOwner)
                .then(() => {
                    if (rendered.renderToken !== renderToken || !isLive()) {
                        this.unloadMarkdownRenderOwner(renderOwner);
                        removeElement(buffer);
                        return false;
                    }
                    this.unloadMarkdownRenderOwner(rendered.renderOwner);
                    rendered.contentDiv.empty();
                    rendered.contentDiv.appendChild(buffer);
                    rendered.renderOwner = renderOwner;
                    rendered.renderedContent = content;
                    rendered.renderedContentMode = mermaidTransform.deferred ? 'deferred-mermaid' : 'full';
                    this.updateClickableLink(buffer);
                    if (!options.deferMermaid) {
                        scheduleMermaidEnhancement(
                            buffer,
                            this.plugin,
                            mermaidTransform.sources,
                            () => rendered.renderToken === renderToken
                                && buffer.parentElement === rendered.contentDiv,
                            renderOwner,
                        );
                    }
                    scrollToBottom({
                        force: options.forceScroll,
                        behavior: options.forceScroll ? 'smooth' : 'auto',
                    });
                    return true;
                })
                .catch(async (error) => {
                    this.unloadMarkdownRenderOwner(renderOwner);
                    if (rendered.renderToken !== renderToken || !isLive()) return false;
                    if (!options.deferMermaid && containsMermaidFence(content)) {
                        removeElement(buffer);
                        const fallbackBuffer = createRenderBuffer();
                        fallbackBuffer.classList.add('message-render-buffer');
                        const fallbackOwner = this.createMarkdownRenderOwner();
                        try {
                            const fallbackTransform = deferMermaidFences(content);
                            await renderMarkdownWithOwner(
                                this.plugin,
                                fallbackTransform.markdown,
                                fallbackBuffer,
                                fallbackOwner,
                            );
                            if (rendered.renderToken !== renderToken || !isLive()) {
                                this.unloadMarkdownRenderOwner(fallbackOwner);
                                removeElement(fallbackBuffer);
                                return false;
                            }
                            renderMermaidSourceWarning(fallbackBuffer);
                            this.unloadMarkdownRenderOwner(rendered.renderOwner);
                            rendered.contentDiv.empty();
                            rendered.contentDiv.appendChild(fallbackBuffer);
                            rendered.renderOwner = fallbackOwner;
                            rendered.renderedContent = content;
                            rendered.renderedContentMode = 'deferred-mermaid';
                            this.updateClickableLink(fallbackBuffer);
                            scrollToBottom({
                                force: options.forceScroll,
                                behavior: options.forceScroll ? 'smooth' : 'auto',
                            });
                            return true;
                        } catch (fallbackError) {
                            this.unloadMarkdownRenderOwner(fallbackOwner);
                            removeElement(fallbackBuffer);
                            error = fallbackError;
                        }
                    }
                    this.unloadMarkdownRenderOwner(rendered.renderOwner);
                    buffer.setText(`Could not render message: ${String(error)}`);
                    rendered.contentDiv.empty();
                    rendered.contentDiv.appendChild(buffer);
                    rendered.renderOwner = undefined;
                    rendered.renderedContent = content;
                    rendered.renderedContentMode = mermaidTransform.deferred ? 'deferred-mermaid' : 'full';
                    scrollToBottom({ force: options.forceScroll, behavior: 'auto' });
                    return true;
                });
        };

        const ensureCompletedMessageActions = (
            rendered: RenderedMessage,
            options: {
                onDelete?: () => void | Promise<void>;
                onAddToEditor?: (content: string) => void | Promise<void>;
                disableDeleteWhileGenerating?: boolean;
            },
        ) => {
            if (options.onAddToEditor && !rendered.addMessageButton) {
                const addMessageButton = createChatMenuItem(rendered.actionMenu, {
                    text: 'Add to Editor',
                    icon: 'file-plus',
                    cls: 'add-to-editor-message-button',
                });
                addMessageButton.onclick = () => {
                    void options.onAddToEditor?.(rendered.copyContent);
                };
                rendered.addMessageButton = addMessageButton;
            }

            if (options.onDelete && !rendered.deleteButton) {
                const deleteButton = createChatMenuItem(rendered.actionMenu, {
                    text: 'Delete',
                    icon: 'trash-2',
                    cls: 'pa-chat-menu-item-danger delete-message-button',
                });
                rendered.deleteButton = deleteButton;
            }

            if (options.onDelete && rendered.deleteButton) {
                const deleteButton = rendered.deleteButton;
                deleteButton.disabled = Boolean(options.disableDeleteWhileGenerating && isGenerating());
                deleteButton.onclick = () => {
                    if (deleteButton.disabled) return;
                    void options.onDelete?.();
                };
                if (options.disableDeleteWhileGenerating && !historyDeleteButtons.includes(deleteButton)) {
                    historyDeleteButtons.push(deleteButton);
                }
            }
        };

        const createMessageElement = (
            message: ChatMessage,
            options: {
                animate?: boolean;
                forceScroll?: boolean;
                isLive?: () => boolean;
                onDelete?: () => void | Promise<void>;
                onAddToEditor?: (content: string) => void | Promise<void>;
                disableDeleteWhileGenerating?: boolean;
                memoryMetadata?: ChatTurnMemoryMetadata;
                showAssistantLoader?: boolean;
                skipInitialRender?: boolean;
            } = {},
        ): RenderedMessage => {
            const messageDiv = this.responseDiv.createDiv({ cls: `llm-message ${message.role}` });
            if (options.animate) {
                messageDiv.classList.add('llm-message-enter');
            }
            if (options.showAssistantLoader) {
                messageDiv.setAttribute('aria-busy', 'true');
            }
            const { roleEl, loaderEl } = createRoleLabel(messageDiv, message.role === 'user' ? 'You' : 'Assistant', {
                loader: options.showAssistantLoader ? 'assistant' : undefined,
            });
            const contentDiv = messageDiv.createDiv({ cls: 'message-content' }) as HTMLElement;
            const actionDiv = messageDiv.createDiv({ cls: 'message-actions' });
            const menuButton = actionDiv.createEl('button', {
                cls: 'message-action-button message-more-button',
                attr: {
                    type: 'button',
                    'aria-label': 'Message actions',
                    title: 'Message actions',
                    'aria-expanded': 'false',
                },
            });
            setIcon(menuButton, 'ellipsis');
            const actionMenu = actionDiv.createDiv({ cls: 'pa-chat-menu pa-chat-message-menu' });
            const rendered: RenderedMessage = {
                messageDiv,
                roleEl,
                loaderEl,
                contentDiv,
                actionMenu,
                renderToken: 0,
                copyContent: message.content,
                memoryMetadata: options.memoryMetadata ?? message.memoryMetadata,
                canonicalTurn: message.canonicalTurn,
            };
            rendered.actionMenu.hidden = true;
            const actionMenuAutoClose = createIdleMenuAutoClose(rendered.actionMenu, menuButton, () => {
                rendered.actionMenu.hidden = true;
                menuButton.setAttribute('aria-expanded', 'false');
            });
            menuButton.onclick = () => {
                if (rendered.actionMenu.hidden) {
                    rendered.actionMenu.hidden = false;
                    menuButton.setAttribute('aria-expanded', 'true');
                    actionMenuAutoClose.schedule();
                } else {
                    actionMenuAutoClose.close();
                }
            };
            const copyButton = createChatMenuItem(rendered.actionMenu, {
                text: 'Copy',
                icon: 'copy',
                cls: 'copy-message-button',
            });
            copyButton.onclick = () => {
                navigator.clipboard.writeText(rendered.copyContent).then(() => {
                    new Notice('Copied to clipboard');
                }).catch(err => {
                    console.error('Could not copy text: ', err);
                });
            };

            ensureCompletedMessageActions(rendered, options);

            if (!options.skipInitialRender) {
                void renderMarkdownInto(rendered, message.content, options.isLive ?? (() => true), {
                    forceScroll: options.forceScroll,
                });
            }
            return rendered;
        };

        const deleteHistoryPairForMessages = async (expectedUser: ChatMessage, expectedAssistant: ChatMessage) => {
            if (isGenerating()) return;
            const pairStart = this.chatHistory.indexOf(expectedUser);
            if (pairStart < 0 || this.chatHistory[pairStart + 1] !== expectedAssistant) return;
            const confirmed = await confirmChatAction(this.plugin, {
                title: 'Delete message?',
                message: 'This deletes the full user and assistant turn from this chat.',
                confirmText: 'Delete',
                danger: true,
            });
            if (!confirmed) return;
            if (!isCurrentSession()) return;
            if (isGenerating()) return;
            const currentPairStart = this.chatHistory.indexOf(expectedUser);
            if (currentPairStart < 0 || this.chatHistory[currentPairStart + 1] !== expectedAssistant) return;
            this.chatHistory.splice(currentPairStart, 2);
            timelineEntries = timelineEntries.filter((entry) =>
                entry.kind !== 'history' || entry.user !== expectedUser || entry.assistant !== expectedAssistant
            );
            renderTimeline();
            new Notice('Message deleted');
        };

        const deleteHistoryPair = async (messageIndex: number) => {
            const pairStart = messageIndex % 2 === 0 ? messageIndex : messageIndex - 1;
            if (pairStart < 0 || pairStart >= this.chatHistory.length) return;
            const expectedUser = this.chatHistory[pairStart];
            const expectedAssistant = this.chatHistory[pairStart + 1];
            if (!expectedAssistant) return;
            await deleteHistoryPairForMessages(expectedUser, expectedAssistant);
        };

        const renderTimeline = () => {
            this.cancelScheduledScroll();
            this.unloadAllMarkdownRenderOwners();
            this.responseDiv.empty();
            historyDeleteButtons = [];
            timelineEntries.forEach((entry, entryIndex) => {
                const forceScroll = entryIndex === timelineEntries.length - 1;
                if (entry.kind === 'history') {
                    const pairStart = this.chatHistory.indexOf(entry.user);
                    if (pairStart === -1 || this.chatHistory[pairStart + 1] !== entry.assistant) return;
                    const metadata = readChatHistoryTurnMetadata(entry.assistant, entry.memoryMetadata);
                    const contextUsedItems = metadata?.contextUsed ?? entry.contextUsedItems ?? [];
                    const runtimeWarnings = entry.assistant.runtimeWarnings ?? [];
                    createMessageElement(entry.user, {
                        onDelete: () => deleteHistoryPair(pairStart),
                        disableDeleteWhileGenerating: true,
                    });
                    if (
                        entry.providerReasoningObserved
                        || contextUsedItems.length > 0
                        || (entry.activityDetails?.length ?? 0) > 0
                        || runtimeWarnings.length > 0
                    ) {
                        const statusView = createThinkingStatusView();
                        entry.activityDetails?.forEach((detail) => appendThinkingStatus(statusView, detail));
                        if (entry.providerReasoningObserved) {
                            renderProviderReasoningNotice(statusView);
                        }
                        renderContextUsedItems(statusView, contextUsedItems);
                        renderRuntimeWarnings(statusView, runtimeWarnings);
                        completeThinkingStatus(
                            statusView,
                            formatCanonicalTerminalSummary(entry.assistant.canonicalTurn?.status, runtimeWarnings),
                        );
                    }
                    createMessageElement(entry.assistant, {
                        forceScroll,
                        onDelete: () => deleteHistoryPair(pairStart + 1),
                        onAddToEditor: (content) => addContentToEditor(content),
                        disableDeleteWhileGenerating: true,
                        memoryMetadata: metadata,
                    });
                    return;
                }

                entry.userMessage = createMessageElement(
                    { role: 'user', content: entry.prompt },
                    { forceScroll },
                );
                createTerminalRow(entry);
            });
            const lastAssistant = [...this.chatHistory].reverse().find((message) => message.role === 'assistant');
            this.result = lastAssistant?.content ?? '';
            renderEmptyState();
        };

        const removeTerminalEntry = (entry: TerminalTurnEntry) => {
            timelineEntries = timelineEntries.filter((candidate) => candidate !== entry);
            this.unloadMarkdownRenderOwner(entry.userMessage?.renderOwner);
            removeElement(entry.userMessage?.messageDiv);
            removeElement(entry.statusView?.messageDiv);
            removeElement(entry.terminalRow);
            renderEmptyState();
        };

        const createTerminalRow = (
            entry: TerminalTurnEntry,
        ) => {
            const row = this.responseDiv.createDiv({ cls: `llm-message system turn-${entry.terminalKind}` });
            createRoleLabel(row, entry.terminalKind === 'error' ? 'Error' : 'Cancelled');
            row.createDiv({ cls: 'message-content', text: entry.content });
            const actions = row.createDiv({ cls: 'message-actions turn-terminal-actions' });
            const retryButton = actions.createEl('button', {
                cls: 'message-action-button retry-message-button',
                attr: {
                    'aria-label': 'Retry message',
                    title: 'Retry message',
                },
            });
            setIcon(retryButton, 'rotate-cw');
            retryButton.onclick = () => {
                if (retryButton.disabled || isGenerating()) return;
                removeTerminalEntry(entry);
                void sendPrompt(entry.prompt);
            };

            const deleteButton = actions.createEl('button', {
                cls: 'message-action-button delete-message-button',
                attr: { 'aria-label': 'Delete message' },
            });
            setIcon(deleteButton, 'trash');
            deleteButton.onclick = () => {
                if (deleteButton.disabled || isGenerating()) return;
                void confirmChatAction(this.plugin, {
                    title: 'Delete message?',
                    message: 'This deletes this unfinished turn from the chat.',
                    confirmText: 'Delete',
                    danger: true,
                }).then((confirmed) => {
                    if (!confirmed) return;
                    if (!isCurrentSession() || isGenerating()) return;
                    if (!entry.terminalRow?.parentElement) return;
                    removeTerminalEntry(entry);
                });
            };
            retryButton.disabled = isGenerating();
            deleteButton.disabled = isGenerating();
            historyDeleteButtons.push(retryButton, deleteButton);

            if (entry.terminalKind === 'error') {
                const copyErrorButton = actions.createEl('button', {
                    cls: 'message-action-button copy-error-button',
                    attr: {
                        type: 'button',
                        'aria-label': 'Copy error',
                        title: 'Copy error',
                    },
                });
                setIcon(copyErrorButton, 'copy');
                copyErrorButton.onclick = () => {
                    navigator.clipboard.writeText(entry.errorDetail ?? entry.content).then(() => {
                        new Notice('Copied to clipboard');
                    }).catch(err => {
                        console.error('Could not copy error: ', err);
                    });
                };
            }

            entry.terminalRow = row;
            scrollToBottom({ force: true });
        };

        const createTerminalEntry = (
            turn: UiTurn,
            content: string,
            terminalKind: TerminalTurnEntry['terminalKind'],
            errorDetail?: string,
        ) => {
            removeElement(turn.assistantMessage?.messageDiv);
            stopThinkingLoader(turn.statusView);
            const entry: TerminalTurnEntry = {
                kind: 'terminal',
                id: turn.id,
                prompt: turn.prompt,
                content,
                terminalKind,
                errorDetail,
                userMessage: turn.userMessage,
                statusView: turn.statusView,
            };
            timelineEntries.push(entry);
            createTerminalRow(entry);
        };

        const createThinkingStatusView = (turn?: UiTurn): ThinkingStatusView => {
            const messageDiv = this.responseDiv.createDiv({ cls: 'llm-message system thinking-status' });
            const assistantMessageDiv = turn?.assistantMessage?.messageDiv;
            if (assistantMessageDiv?.parentElement === this.responseDiv) {
                this.responseDiv.insertBefore(messageDiv, assistantMessageDiv);
            }
            messageDiv.setAttribute('aria-busy', 'true');
            const headerDiv = messageDiv.createDiv({ cls: 'thinking-status-header' });
            const detailsId = `pa-chat-thinking-details-${sessionId}-${++thinkingStatusId}`;
            const toggleButton = headerDiv.createEl('button', {
                cls: 'thinking-status-toggle',
                attr: {
                    type: 'button',
                    'aria-label': 'Show thinking details',
                    'aria-expanded': 'false',
                    'aria-controls': detailsId,
                },
            });
            setIcon(toggleButton, 'chevron-right');
            const { loaderEl } = createRoleLabel(headerDiv, 'Thinking', {
                extraClass: 'thinking-status-role',
                loader: 'thinking',
            });
            const summaryEl = headerDiv.createDiv({ cls: 'thinking-status-summary' });
            summaryEl.setAttribute('aria-live', 'polite');
            const detailsEl = messageDiv.createDiv({ cls: 'thinking-status-details' });
            detailsEl.id = detailsId;
            detailsEl.hidden = true;
            const activitySectionEl = detailsEl.createDiv({ cls: 'thinking-status-section thinking-status-activity' });
            activitySectionEl.createDiv({ cls: 'thinking-status-section-title', text: 'Assistant activity' });
            const activityListEl = activitySectionEl.createDiv({ cls: 'thinking-status-activity-list' });

            const statusView: ThinkingStatusView = {
                messageDiv,
                summaryEl,
                detailsEl,
                activityListEl,
                toggleButton,
                loaderEl,
                expanded: false,
                detailItems: [],
            };

            const toggleThinkingDetails = () => {
                pauseAutoScroll();
                statusView.expanded = !statusView.expanded;
                detailsEl.hidden = !statusView.expanded;
                toggleButton.setAttribute('aria-expanded', String(statusView.expanded));
                toggleButton.setAttribute(
                    'aria-label',
                    statusView.expanded ? 'Hide thinking details' : 'Show thinking details'
                );
                setIcon(toggleButton, statusView.expanded ? 'chevron-down' : 'chevron-right');
            };
            toggleButton.onclick = (event) => {
                event.stopPropagation();
                toggleThinkingDetails();
            };

            return statusView;
        };

        const appendThinkingStatus = (statusView: ThinkingStatusView, content: string) => {
            const MAX_THINKING_DETAIL_ITEMS = 6;
            statusView.summaryEl.setText(content);
            if (statusView.lastDetail !== content) {
                statusView.lastDetail = content;
                const detailItem = statusView.activityListEl.createDiv({ cls: 'thinking-status-detail-item', text: content });
                statusView.detailItems.push(detailItem);
                while (statusView.detailItems.length > MAX_THINKING_DETAIL_ITEMS) {
                    removeElement(statusView.detailItems.shift());
                }
            }
            scrollToBottom();
        };

        const appendThinkingDetail = (statusView: ThinkingStatusView, content: string) => {
            const MAX_THINKING_DETAIL_ITEMS = 6;
            if (statusView.lastDetail === content) return;
            statusView.lastDetail = content;
            const detailItem = statusView.activityListEl.createDiv({ cls: 'thinking-status-detail-item', text: content });
            statusView.detailItems.push(detailItem);
            while (statusView.detailItems.length > MAX_THINKING_DETAIL_ITEMS) {
                removeElement(statusView.detailItems.shift());
            }
            scrollToBottom();
        };

        const ensureProviderReasoningNotice = (statusView: ThinkingStatusView) => {
            if (statusView.reasoningContentEl) return statusView.reasoningContentEl;
            const section = statusView.detailsEl.createDiv({ cls: 'thinking-status-section thinking-status-reasoning' });
            section.createDiv({ cls: 'thinking-status-section-title', text: 'Provider thinking' });
            const contentEl = section.createDiv({ cls: 'thinking-status-reasoning-content' });
            statusView.reasoningSectionEl = section;
            statusView.reasoningContentEl = contentEl;
            return contentEl;
        };

        const renderProviderReasoningNotice = (statusView: ThinkingStatusView) => {
            const contentEl = ensureProviderReasoningNotice(statusView);
            contentEl.setText('Provider reasoning was received but is hidden. It is not a source or a Memory reference.');
        };

        const appendProviderReasoning = (turn: UiTurn, delta: string) => {
            if (!delta) return;
            turn.providerReasoningObserved = true;
            turn.statusView ??= createThinkingStatusView(turn);
            turn.statusView.summaryEl.setText('Qwen model is thinking...');
            renderProviderReasoningNotice(turn.statusView);
            scrollToBottom();
        };

        const ensureWarningList = (statusView: ThinkingStatusView) => {
            if (statusView.warningListEl) return statusView.warningListEl;
            const section = statusView.detailsEl.createDiv({ cls: 'thinking-status-section thinking-status-warnings' });
            section.createDiv({ cls: 'thinking-status-section-title', text: 'Warnings' });
            const listEl = section.createDiv({ cls: 'thinking-status-warning-list' });
            statusView.warningSectionEl = section;
            statusView.warningListEl = listEl;
            return listEl;
        };

        const renderRuntimeWarnings = (
            statusView: ThinkingStatusView,
            warnings: RuntimeWarningViewItem[],
        ) => {
            if (warnings.length === 0) {
                removeElement(statusView.warningSectionEl);
                statusView.warningSectionEl = undefined;
                statusView.warningListEl = undefined;
                return;
            }
            const listEl = ensureWarningList(statusView);
            listEl.empty();
            warnings.forEach((warning) => {
                const row = listEl.createDiv({ cls: `thinking-status-warning-item warning-${warning.type}` });
                row.createDiv({
                    cls: 'thinking-status-warning-label',
                    text: formatRuntimeWarningLabel(warning),
                });
                const detail = formatRuntimeWarningDetail(warning);
                if (detail) {
                    row.createDiv({ cls: 'thinking-status-warning-detail', text: detail });
                }
            });
        };

        const completeThinkingStatus = (statusView: ThinkingStatusView, summary = 'Thinking complete') => {
            stopThinkingLoader(statusView);
            statusView.summaryEl.setText(summary);
        };

        const displaySourceName = (path: string): string => {
            const cleanPath = path.trim();
            if (!cleanPath) return 'Untitled note';
            const lastSegment = cleanPath.split('/').filter(Boolean).pop() ?? cleanPath;
            return lastSegment.replace(/\.md$/i, '') || 'Untitled note';
        };

        const formatSourceSummary = (sources: { path: string }[] | undefined): string => {
            const names = [...new Set((sources ?? []).map((source) => displaySourceName(source.path)).filter(Boolean))];
            if (names.length === 0) return '';
            const visible = names.slice(0, 4).join(', ');
            const remaining = names.length - 4;
            return remaining > 0 ? `${visible}, +${remaining} more` : visible;
        };

        const getToolContextUsedInfo = (tool: string): Pick<ChatContextUsedItem, 'category' | 'label' | 'detail'> => {
            if (tool === 'inspect_obsidian_note') {
                return {
                    category: 'read-only-tool',
                    label: 'Note structure',
                    detail: 'Read-only note structure, links/backlinks, tasks, and properties',
                };
            }
            if (tool === 'read_canvas_summary') {
                return {
                    category: 'read-only-tool',
                    label: 'Canvas structure',
                    detail: 'Read-only canvas structure',
                };
            }
            if (tool === 'search_vault_snippets') {
                return {
                    category: 'read-only-tool',
                    label: 'Note snippets',
                    detail: 'Bounded note snippet search results',
                };
            }
            if (tool === 'list_vault_tags') {
                return {
                    category: 'read-only-tool',
                    label: 'Vault tags',
                    detail: 'Read-only vault tag counts',
                };
            }
            if (tool === 'get_current_note_context') {
                return {
                    category: 'current-note',
                    label: 'Current note',
                    detail: 'Read-only current note context',
                };
            }
            if (tool === 'search_vault_metadata') {
                return {
                    category: 'vault-metadata',
                    label: 'Vault metadata',
                    detail: 'Read-only metadata search results',
                };
            }
            if (tool === 'list_recent_notes') {
                return {
                    category: 'recent-notes',
                    label: 'Recent notes',
                    detail: 'Read-only recent note list',
                };
            }
            if (tool === 'read_note_outline') {
                return {
                    category: 'note-outline',
                    label: 'Note outline',
                    detail: 'Read-only note outline',
                };
            }
            return {
                category: 'read-only-tool',
                label: 'Read-only tool',
                detail: 'Read-only tool context',
            };
        };

        const formatToolRunningStatus = (tool: string): string => {
            if (tool === 'get_current_note_context') return 'Reading current note...';
            if (tool === 'inspect_obsidian_note') return 'Reading note structure...';
            if (tool === 'read_canvas_summary') return 'Checking canvas structure...';
            if (tool === 'search_vault_snippets') return 'Searching note snippets...';
            if (tool === 'list_vault_tags') return 'Reading vault tags...';
            if (tool === 'search_vault_metadata') return 'Searching vault metadata...';
            if (tool === 'list_recent_notes') return 'Reading recent notes...';
            if (tool === 'read_note_outline') return 'Reading note outline...';
            return 'Reading vault context...';
        };

        const dedupeContextSources = (sources: ChatContextUsedItem['sources'] = []) => {
            const seen = new Set<string>();
            return sources.filter((source) => {
                if (!source.path) return false;
                const key = `${source.path}:${source.chunkIndex ?? ''}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, 6);
        };

        const mergeContextUsedItems = (
            current: ChatContextUsedItem[],
            incoming: ChatContextUsedItem[],
        ): ChatContextUsedItem[] => {
            const byKey = new Map<string, ChatContextUsedItem>();
            for (const item of [...current, ...incoming]) {
                const key = `${item.category}:${item.label}`;
                const existing = byKey.get(key);
                if (!existing) {
                    byKey.set(key, {
                        ...item,
                        sources: dedupeContextSources(item.sources),
                    });
                    continue;
                }
                existing.sources = dedupeContextSources([
                    ...(existing.sources ?? []),
                    ...(item.sources ?? []),
                ]);
                existing.detail ??= item.detail;
                existing.citationEligible = Boolean(existing.citationEligible || item.citationEligible);
                existing.statusOnly = Boolean(existing.statusOnly || item.statusOnly);
            }
            return [...byKey.values()].slice(0, 12);
        };

        const normalizeContextUsedItems = (value: unknown): ChatContextUsedItem[] => {
            if (!Array.isArray(value)) return [];
            return value
                .map((item): ChatContextUsedItem | null => {
                    if (!item || typeof item !== 'object') return null;
                    const record = item as Record<string, unknown>;
                    if (typeof record.category !== 'string' || typeof record.label !== 'string') return null;
                    return {
                        category: record.category as ChatContextUsedItem['category'],
                        label: record.label,
                        detail: typeof record.detail === 'string' ? record.detail : undefined,
                        sources: Array.isArray(record.sources)
                            ? record.sources
                                .map((source): NonNullable<ChatContextUsedItem['sources']>[number] | null => {
                                    if (!source || typeof source !== 'object') return null;
                                    const sourceRecord = source as Record<string, unknown>;
                                    if (typeof sourceRecord.path !== 'string') return null;
                                    return {
                                        path: sourceRecord.path,
                                        chunkIndex: typeof sourceRecord.chunkIndex === 'number'
                                            ? sourceRecord.chunkIndex
                                            : undefined,
                                        score: typeof sourceRecord.score === 'number'
                                            ? sourceRecord.score
                                            : undefined,
                                    };
                                })
                                .filter((source): source is NonNullable<ChatContextUsedItem['sources']>[number] => Boolean(source))
                            : undefined,
                        citationEligible: record.citationEligible === true,
                        statusOnly: record.statusOnly === true,
                    };
                })
                .filter((item): item is ChatContextUsedItem => Boolean(item));
        };

        const normalizeSourceRecords = (value: unknown): SourceRecord[] => {
            if (!Array.isArray(value)) return [];
            return value
                .map((item): SourceRecord | null => {
                    if (!item || typeof item !== 'object') return null;
                    const record = item as Record<string, unknown>;
                    if (typeof record.kind !== 'string' || typeof record.dedupKey !== 'string') return null;
                    return {
                        kind: record.kind as SourceRecord['kind'],
                        dedupKey: record.dedupKey,
                        turnId: typeof record.turnId === 'string' ? record.turnId : undefined,
                        providerId: typeof record.providerId === 'string' ? record.providerId : undefined,
                        capabilityName: typeof record.capabilityName === 'string' ? record.capabilityName : undefined,
                        sourceBoundary: typeof record.sourceBoundary === 'string'
                            ? record.sourceBoundary as SourceRecord['sourceBoundary']
                            : undefined,
                        title: typeof record.title === 'string' ? record.title : undefined,
                        path: typeof record.path === 'string' ? record.path : undefined,
                        url: typeof record.url === 'string' ? record.url : undefined,
                        snippet: typeof record.snippet === 'string' ? record.snippet : undefined,
                        score: typeof record.score === 'number' ? record.score : undefined,
                        chunkIndex: typeof record.chunkIndex === 'number' ? record.chunkIndex : undefined,
                        truncated: record.truncated === true,
                        redacted: record.redacted === true,
                        citationEligible: record.citationEligible === true,
                        statusOnly: record.statusOnly === true,
                        metadata: record.metadata && typeof record.metadata === 'object'
                            ? record.metadata as Record<string, unknown>
                            : undefined,
                    };
                })
                .filter((item): item is SourceRecord => Boolean(item));
        };

        const mergeSourceRecords = (current: SourceRecord[], incoming: SourceRecord[]): SourceRecord[] => {
            const byKey = new Map<string, SourceRecord>();
            for (const record of [...current, ...incoming]) {
                const key = [
                    record.dedupKey,
                    record.sourceBoundary ?? '',
                    record.path ?? '',
                    record.url ?? '',
                    record.title ?? '',
                ].join('\u0000');
                if (!byKey.has(key)) {
                    byKey.set(key, record);
                }
            }
            return [...byKey.values()];
        };

        const ensureContextUsedList = (statusView: ThinkingStatusView) => {
            if (statusView.contextUsedListEl) return statusView.contextUsedListEl;
            const section = statusView.detailsEl.createDiv({ cls: 'thinking-status-section thinking-status-context-used' });
            section.createDiv({ cls: 'thinking-status-section-title', text: 'Context Used' });
            const listEl = section.createDiv({ cls: 'thinking-status-context-list' });
            statusView.contextUsedSectionEl = section;
            statusView.contextUsedListEl = listEl;
            return listEl;
        };

        const renderContextUsedItems = (
            statusView: ThinkingStatusView,
            items: ChatContextUsedItem[],
        ) => {
            if (items.length === 0) {
                removeElement(statusView.contextUsedSectionEl);
                statusView.contextUsedSectionEl = undefined;
                statusView.contextUsedListEl = undefined;
                return;
            }
            const listEl = ensureContextUsedList(statusView);
            listEl.empty();
            items.forEach((item) => {
                const row = listEl.createDiv({ cls: `thinking-status-context-item context-used-${item.category}` });
                row.createDiv({ cls: 'thinking-status-context-label', text: item.label });
                if (item.detail) {
                    row.createDiv({ cls: 'thinking-status-context-detail', text: item.detail });
                }
                const sourceSummary = formatSourceSummary(item.sources);
                if (sourceSummary) {
                    row.createDiv({ cls: 'thinking-status-context-sources', text: sourceSummary });
                }
                if (item.citationEligible) {
                    row.createDiv({ cls: 'thinking-status-context-note', text: 'Eligible for Memory references' });
                } else if (item.statusOnly) {
                    row.createDiv({ cls: 'thinking-status-context-note', text: 'Status only' });
                } else {
                    row.createDiv({ cls: 'thinking-status-context-note', text: 'Not a Memory reference' });
                }
            });
        };

        const addContextUsedItems = (turn: UiTurn, items: ChatContextUsedItem[]) => {
            if (items.length === 0) return;
            turn.contextUsedItems = mergeContextUsedItems(turn.contextUsedItems, items);
            turn.statusView ??= createThinkingStatusView(turn);
            renderContextUsedItems(turn.statusView, turn.contextUsedItems);
        };

        const isDuplicateReadOnlyToolSkip = (status: ChatAgentStatus): boolean => (
            status.type === 'tool-skipped'
            && status.reason === 'Duplicate read-only tool call skipped.'
        );

        const getContextUsedItemsFromStatus = (status: ChatAgentStatus): ChatContextUsedItem[] => {
            if (status.type === 'memory-selected' || status.type === 'memory-expanded') {
                if (status.sources.length === 0) return [];
                return [{
                    category: 'memory',
                    label: 'Selected Memory',
                    detail: status.sources.length === 1 ? '1 selected note' : `${status.sources.length} selected notes`,
                    sources: status.sources,
                    citationEligible: true,
                }];
            }
            if (status.type === 'tool-done') {
                const toolInfo = getToolContextUsedInfo(status.tool);
                if (status.availability === 'unavailable') {
                    return [{
                        category: 'tool-unavailable',
                        label: `${toolInfo.label} unavailable`,
                        detail: 'Vault context was unavailable for this turn.',
                        sources: status.sources,
                        citationEligible: false,
                        statusOnly: true,
                    }];
                }
                return [{
                    category: toolInfo.category,
                    label: toolInfo.label,
                    detail: status.availability === 'partial' ? `Partial ${toolInfo.detail}` : toolInfo.detail,
                    sources: status.sources,
                    citationEligible: false,
                }];
            }
            if (status.type === 'tool-skipped') {
                if (isDuplicateReadOnlyToolSkip(status)) return [];
                const toolInfo = getToolContextUsedInfo(status.tool);
                return [{
                    category: 'tool-unavailable',
                    label: `${toolInfo.label} unavailable`,
                    detail: 'Vault context was unavailable for this turn.',
                    statusOnly: true,
                }];
            }
            if (status.type === 'fallback') {
                const isLoopCap = /cap reached|stopped before/i.test(status.reason);
                return [{
                    category: isLoopCap ? 'loop-cap' : 'fallback',
                    label: isLoopCap ? 'Using gathered context' : 'Available context',
                    detail: isLoopCap
                        ? 'Answering from context gathered before the planning limit was reached.'
                        : 'Answering from available context for this turn.',
                    statusOnly: true,
                }];
            }
            return [];
        };

        const formatAgentStatus = (status: ChatAgentStatus): string => {
            if (status.type === 'thinking') {
                return 'Deciding what context to use...';
            } else if (status.type === 'memory-prefetching') {
                return `Searching notes: ${status.query}`;
            } else if (status.type === 'memory-prefetched') {
                const sources = formatSourceSummary(status.sources);
                return sources ? `Related notes found: ${sources}` : 'No related memory';
            } else if (status.type === 'memory-reranking') {
                return `Checking ${status.candidateCount} related note${status.candidateCount === 1 ? '' : 's'}...`;
            } else if (status.type === 'memory-selected') {
                const sources = formatSourceSummary(status.sources);
                return sources ? `Selected memory: ${sources}` : 'No relevant memory selected';
            } else if (status.type === 'memory-expanded') {
                return 'Reading selected Memory...';
            } else if (status.type === 'retrieving') {
                return `Searching notes: ${status.query}`;
            } else if (status.type === 'retrieved') {
                const sources = formatSourceSummary(status.sources);
                return sources ? `Related notes found: ${sources}` : 'No related memory';
            } else if (status.type === 'memory-skipped') {
                return /returned 0 source/i.test(status.reason) ? 'No related memory' : 'Memory skipped';
            } else if (status.type === 'tool-running') {
                return formatToolRunningStatus(status.tool);
            } else if (status.type === 'tool-done') {
                const sources = formatSourceSummary(status.sources);
                return sources ? `${status.message}: ${sources}` : status.message;
            } else if (status.type === 'tool-skipped') {
                if (isDuplicateReadOnlyToolSkip(status)) return 'Vault context already gathered';
                return 'Vault context unavailable';
            } else if (status.type === 'answering') {
                return 'Answering...';
            } else if (status.type === 'fallback') {
                return /cap reached|stopped before/i.test(status.reason)
                    ? 'Using gathered context after reaching the planning limit.'
                    : 'Answering from available context.';
            }
            return 'Thinking...';
        };

        const formatCanonicalToolStatus = (toolName: string): string => {
            if (toolName === 'search_memory') return 'Searching Memory...';
            if (toolName === 'webSearch') return 'Searching the web...';
            return formatToolRunningStatus(toolName);
        };

        const formatCanonicalToolCompletedStatus = (toolName: string, outcome: string): string => {
            const label = toolName === 'search_memory'
                ? 'Memory search'
                : toolName === 'webSearch'
                    ? 'WebSearch'
                    : getToolContextUsedInfo(toolName).label;
            if (outcome === 'success') return `${label} complete`;
            if (outcome === 'budget_exceeded') return `${label} skipped: budget reached`;
            if (outcome === 'duplicate_skipped') return `${label} already gathered`;
            if (outcome === 'aborted' || outcome === 'abort_timeout') return `${label} stopped`;
            return `${label} unavailable`;
        };

        const formatRuntimeWarningType = (type: string): string => {
            if (type === 'required_capability_missing') return 'Answer may be incomplete';
            if (type === 'provider_partial_error') return 'Answer stopped early';
            if (type === 'assistant_idle_timeout') return 'Assistant stopped responding';
            if (type === 'assistant_empty_response') return 'Answer incomplete';
            if (type === 'wall_clock_exceeded') return 'Runtime limit reached';
            return 'Answer warning';
        };

        const formatRuntimeWarningLabel = (warning: RuntimeWarningViewItem): string => {
            if (warning.type === 'assistant_empty_response') return formatRuntimeWarningType(warning.type);
            return warning.message ?? formatRuntimeWarningType(warning.type);
        };

        const formatRuntimeWarningDetail = (warning: RuntimeWarningViewItem): string | undefined => {
            if (warning.type === 'assistant_empty_response') return 'No final answer was produced.';
            return warning.detail ?? warning.capability;
        };

        const formatCanonicalTerminalSummary = (
            status: string | undefined,
            warnings: RuntimeWarningViewItem[] = [],
        ): string => {
            if (status === 'incomplete' || warnings.some((warning) => warning.type === 'assistant_empty_response')) {
                return 'Answer incomplete';
            }
            if (status === 'aborted') return 'Generation cancelled';
            if (status === 'error') return 'Answer failed';
            if (status === 'completed_with_warning' || warnings.length > 0) return 'Answer completed with warning';
            return 'Thinking complete';
        };

        const renderAgentStatus = (turn: UiTurn, status: ChatAgentStatus) => {
            turn.statusView ??= createThinkingStatusView(turn);
            const content = formatAgentStatus(status);
            if (turn.activityDetails[turn.activityDetails.length - 1] !== content) {
                turn.activityDetails.push(content);
                while (turn.activityDetails.length > 6) {
                    turn.activityDetails.shift();
                }
            }
            appendThinkingStatus(turn.statusView, content);
            addContextUsedItems(turn, getContextUsedItemsFromStatus(status));
        };

        const addCanonicalActivity = (turn: UiTurn, content: string) => {
            turn.statusView ??= createThinkingStatusView(turn);
            if (turn.activityDetails[turn.activityDetails.length - 1] !== content) {
                turn.activityDetails.push(content);
                while (turn.activityDetails.length > 6) {
                    turn.activityDetails.shift();
                }
            }
            appendThinkingStatus(turn.statusView, content);
        };

        const upsertCanonicalMessage = (turn: UiTurn, message: PaAgentMessage) => {
            turn.canonicalLifecycle.messagesById.set(message.id, message);
            const index = turn.canonicalLifecycle.messages.findIndex((candidate) => candidate.id === message.id);
            if (index >= 0) {
                turn.canonicalLifecycle.messages[index] = message;
            } else {
                turn.canonicalLifecycle.messages.push(message);
            }
        };

        const addCanonicalRuntimeWarnings = (turn: UiTurn, warnings: unknown) => {
            if (!Array.isArray(warnings)) return;
            const normalized = warnings
                .map((warning): RuntimeWarningViewItem | null => {
                    if (!warning || typeof warning !== 'object') return null;
                    const record = warning as Record<string, unknown>;
                    const type = typeof record.type === 'string'
                        ? record.type
                        : (typeof record.kind === 'string' ? record.kind : 'runtime_warning');
                    return {
                        type,
                        message: typeof record.message === 'string' ? record.message : undefined,
                        detail: typeof record.detail === 'string' ? record.detail : undefined,
                        capability: typeof record.capability === 'string' ? record.capability : undefined,
                        metadata: record.metadata && typeof record.metadata === 'object'
                            ? record.metadata as Record<string, unknown>
                            : undefined,
                    };
                })
                .filter((warning): warning is RuntimeWarningViewItem => Boolean(warning));
            if (normalized.length === 0) return;
            const existingKeys = new Set(turn.canonicalLifecycle.warnings.map(runtimeWarningKey));
            const nextWarnings = normalized.filter((warning) => {
                const key = runtimeWarningKey(warning);
                if (existingKeys.has(key)) return false;
                existingKeys.add(key);
                return true;
            });
            if (nextWarnings.length === 0) return;
            turn.canonicalLifecycle.warnings = [...turn.canonicalLifecycle.warnings, ...nextWarnings];
            turn.statusView ??= createThinkingStatusView(turn);
            renderRuntimeWarnings(turn.statusView, turn.canonicalLifecycle.warnings);
        };

        const runtimeWarningKey = (warning: RuntimeWarningViewItem): string => JSON.stringify([
            warning.type,
            warning.message ?? '',
            warning.detail ?? '',
            warning.capability ?? '',
        ]);

        const addCanonicalHostContextMetadata = (turn: UiTurn, hostContext: unknown, turnId: string) => {
            if (!hostContext || typeof hostContext !== 'object') return;
            const record = hostContext as Record<string, unknown>;
            const contextUsed = normalizeContextUsedItems(record.contextUsed);
            const sourceRecords = normalizeSourceRecords(record.sourceRecords)
                .map((sourceRecord) => ({
                    ...sourceRecord,
                    turnId: sourceRecord.turnId ?? turnId,
                }));
            if (contextUsed.length > 0) {
                turn.canonicalLifecycle.hostContextUsedItems = mergeContextUsedItems(
                    turn.canonicalLifecycle.hostContextUsedItems,
                    contextUsed,
                );
                addContextUsedItems(turn, contextUsed);
            }
            if (sourceRecords.length > 0) {
                turn.canonicalLifecycle.hostSourceRecords = mergeSourceRecords(
                    turn.canonicalLifecycle.hostSourceRecords,
                    sourceRecords,
                );
            }
        };

        const persistCanonicalTurnFromLifecycle = (turn: UiTurn, responseContent: string) => {
            const canonical = turn.canonicalLifecycle;
            if (!canonical.active || !canonical.runId) return undefined;
            const turnId = canonical.finalTurnId
                ?? [...canonical.turnStatuses.keys()].at(-1)
                ?? canonical.currentTurnId;
            if (!turnId) return undefined;
            return createPaAgentPersistedTurn({
                runId: canonical.runId,
                turnId,
                status: canonical.turnStatuses.get(turnId) as TurnEndStatus | undefined,
                committedFinalText: responseContent,
                sourceRecords: canonical.hostSourceRecords,
                contextUsed: canonical.hostContextUsedItems,
                messages: canonical.messages,
            });
        };

        const refreshTurnMetadataFromCanonical = (turn: UiTurn, canonicalTurn: PaAgentPersistedTurn | undefined) => {
            if (!canonicalTurn) return;
            const assistantForMetadata: ChatMessage = {
                role: 'assistant',
                content: canonicalTurn.committedFinalText ?? '',
                canonicalTurn,
            };
            const metadata = readChatHistoryTurnMetadata(assistantForMetadata, turn.memoryMetadata);
            if (!metadata) return;
            turn.memoryMetadata = metadata;
            turn.contextUsedItems = mergeContextUsedItems(turn.contextUsedItems, metadata.contextUsed ?? []);
            if (turn.assistantMessage) {
                turn.assistantMessage.memoryMetadata = metadata;
                turn.assistantMessage.canonicalTurn = canonicalTurn;
            }
            if (turn.statusView) {
                renderContextUsedItems(turn.statusView, turn.contextUsedItems);
            }
        };

        const handleCanonicalLifecycleEvent = (
            turn: UiTurn,
            event: AgentEvent,
            setResponseContent: (content: string) => void,
            isLiveTurn: () => boolean,
        ) => {
            if (!isLiveTurn()) return;
            const canonical = turn.canonicalLifecycle;
            if (canonical.terminalStatus) return;

            if (event.type === 'agent_start') {
                canonical.active = true;
                canonical.runId = event.runId;
                addCanonicalActivity(turn, 'Starting assistant run...');
                return;
            }
            if (canonical.runId && event.runId !== canonical.runId) return;

            switch (event.type) {
                case 'turn_start':
                    canonical.active = true;
                    canonical.runId ??= event.runId;
                    canonical.currentTurnId = event.turnId;
                    addCanonicalHostContextMetadata(turn, event.metadata?.hostContext, event.turnId);
                    addCanonicalActivity(turn, event.metadata?.runtimeInstruction
                        ? 'Continuing with tool results...'
                        : 'Deciding what context to use...');
                    return;
                case 'message_start':
                    upsertCanonicalMessage(turn, event.message);
                    if (event.message.role === 'assistant') {
                        canonical.sawToolCallInAssistantMessage = false;
                    }
                    return;
                case 'message_update':
                    if (event.update.kind === 'thinking_delta') {
                        turn.providerReasoningObserved = true;
                        turn.statusView ??= createThinkingStatusView(turn);
                        renderProviderReasoningNotice(turn.statusView);
                        addCanonicalActivity(turn, 'Reading model progress...');
                    } else if (event.update.kind === 'text_delta') {
                        setResponseContent((turn.assistantMessage?.copyContent ?? '') + event.update.text);
                    } else if (event.update.kind === 'toolcall_start') {
                        canonical.sawToolCallInAssistantMessage = true;
                        if (typeof event.metadata?.reclassifiedPendingText === 'string') {
                            canonical.pendingAnswerReclassified = true;
                            setResponseContent('');
                            const reclassified = event.metadata.reclassifiedPendingText.trim();
                            if (reclassified) {
                                addCanonicalActivity(turn, `Draft before tool use: ${reclassified.slice(0, 240)}`);
                            }
                            addCanonicalActivity(turn, 'Moving draft text to progress before using tools...');
                        }
                        addCanonicalActivity(turn, event.update.name
                            ? `Preparing ${event.update.name}...`
                            : 'Preparing tool call...');
                    } else if (event.update.kind === 'toolcall_delta') {
                        canonical.sawToolCallInAssistantMessage = true;
                    }
                    return;
                case 'message_end':
                    upsertCanonicalMessage(turn, event.message);
                    if (event.message.role === 'assistant') {
                        if (event.message.content.some((part) => part.type === 'toolCall')) {
                            setResponseContent('');
                            return;
                        }
                        const finalText = event.message.content
                            .filter((part) => part.type === 'text')
                            .map((part) => part.text)
                            .join('');
                        if (finalText) setResponseContent(finalText);
                    } else if (event.message.role === 'toolResult') {
                        addContextUsedItems(turn, event.message.content.contextUsed ?? []);
                        addCanonicalActivity(turn, `${event.message.toolName} result received`);
                        if (event.message.content.previewText) {
                            turn.statusView ??= createThinkingStatusView(turn);
                            appendThinkingDetail(turn.statusView, event.message.content.previewText);
                        }
                    }
                    return;
                case 'tool_execution_start':
                    addCanonicalActivity(turn, formatCanonicalToolStatus(event.toolName));
                    return;
                case 'tool_execution_update':
                    addCanonicalActivity(turn, event.toolName);
                    return;
                case 'tool_execution_end':
                    addCanonicalActivity(turn, formatCanonicalToolCompletedStatus(event.toolName, event.outcome));
                    return;
                case 'turn_end':
                    canonical.turnStatuses.set(event.turnId, event.status);
                    for (const toolResult of event.toolResults ?? []) {
                        upsertCanonicalMessage(turn, toolResult);
                        addContextUsedItems(turn, toolResult.content.contextUsed ?? []);
                    }
                    if (event.metadata?.diagnostics) {
                        addCanonicalRuntimeWarnings(turn, event.metadata.diagnostics);
                    }
                    return;
                case 'agent_end':
                    canonical.terminalStatus = event.status;
                    canonical.finalTurnId = typeof event.metadata?.finalTurnId === 'string'
                        ? event.metadata.finalTurnId
                        : canonical.finalTurnId;
                    addCanonicalRuntimeWarnings(turn, event.metadata?.warnings);
                    addCanonicalRuntimeWarnings(turn, event.metadata?.diagnostics);
                    if (turn.statusView) {
                        completeThinkingStatus(
                            turn.statusView,
                            formatCanonicalTerminalSummary(event.status, turn.canonicalLifecycle.warnings),
                        );
                    }
                    return;
            }
        };

        const finalizeSuccessfulTurn = async (
            turn: UiTurn,
            prompt: string,
            responseContent: string,
            isLiveTurn: () => boolean,
        ) => {
            const userRendered = turn.userMessage;
            const assistantRendered = turn.assistantMessage;
            if (!userRendered || !assistantRendered) return false;
            const canonicalTurn = persistCanonicalTurnFromLifecycle(turn, responseContent);
            refreshTurnMetadataFromCanonical(turn, canonicalTurn);

            assistantRendered.memoryMetadata = turn.memoryMetadata;
            assistantRendered.canonicalTurn = canonicalTurn;
            if (
                responseContent
                && (
                    assistantRendered.renderedContent !== responseContent
                    || assistantRendered.renderedContentMode !== 'full'
                )
            ) {
                const rendered = await renderMarkdownInto(assistantRendered, responseContent, isLiveTurn);
                if (!rendered || !isLiveTurn()) return false;
            }

            if (!isLiveTurn()) return false;

            const userMessage: ChatMessage = { role: 'user', content: prompt };
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: responseContent,
                ...(canonicalTurn ? { canonicalTurn } : {}),
                ...(canonicalTurn && turn.memoryMetadata ? { memoryMetadata: turn.memoryMetadata } : {}),
                ...(turn.canonicalLifecycle.warnings.length > 0
                    ? { runtimeWarnings: turn.canonicalLifecycle.warnings.map((warning) => ({ ...warning })) }
                    : {}),
            };
            this.chatHistory.push(userMessage, assistantMessage);
            timelineEntries.push({
                kind: 'history',
                user: userMessage,
                assistant: assistantMessage,
                memoryMetadata: turn.memoryMetadata,
                contextUsedItems: turn.contextUsedItems,
                activityDetails: turn.activityDetails,
                providerReasoningObserved: turn.providerReasoningObserved,
            });
            this.result = responseContent;

            const deleteCompletedPair = () => deleteHistoryPairForMessages(userMessage, assistantMessage);
            ensureCompletedMessageActions(userRendered, {
                onDelete: deleteCompletedPair,
                disableDeleteWhileGenerating: true,
            });
            ensureCompletedMessageActions(assistantRendered, {
                onDelete: deleteCompletedPair,
                onAddToEditor: (content) => addContentToEditor(content),
                disableDeleteWhileGenerating: true,
            });

            removeElement(assistantRendered.loaderEl);
            assistantRendered.loaderEl = undefined;
            assistantRendered.messageDiv.removeAttribute('aria-busy');
            if (
                    turn.statusView
                    && (
                        turn.providerReasoningObserved
                        || turn.contextUsedItems.length > 0
                        || turn.activityDetails.length > 0
                        || turn.canonicalLifecycle.warnings.length > 0
                        || (
                            turn.canonicalLifecycle.terminalStatus !== undefined
                            && turn.canonicalLifecycle.terminalStatus !== 'completed'
                        )
                    )
                ) {
                completeThinkingStatus(
                    turn.statusView,
                    formatCanonicalTerminalSummary(
                        turn.canonicalLifecycle.terminalStatus,
                        turn.canonicalLifecycle.warnings,
                    ),
                );
            } else {
                stopThinkingLoader(turn.statusView);
                removeElement(turn.statusView?.messageDiv);
                turn.statusView = undefined;
            }
            renderEmptyState();
            return true;
        };

        const sendPrompt = async (prompt: string) => {
            if (!prompt.trim() || isGenerating()) return;
            isStopping = false;
            removeElement(emptyStateEl);
            emptyStateEl = null;
            sendButton.disabled = true;
            shouldAutoScroll = true;
            const turnId = this.startTurn();
            const controller = new AbortController();
            this.abortController = controller;
            const isLiveTurn = () => this.isCurrentTurn(sessionId, turnId, controller);
            const isSameTurn = () => this.isCurrentTurn(sessionId, turnId, controller, { includeCancelled: true });
            const modelHistory = this.chatHistory.map((message) => ({ ...message }));
            const previousResult = this.result;
            const turn: UiTurn = {
                id: ++uiTurnId,
                prompt,
                contextUsedItems: [],
                activityDetails: [],
                canonicalLifecycle: createCanonicalLifecycleState(),
            };
            const isUiTurnVisible = () => isCurrentSession()
                && this.activeTurnId === turnId
                && Boolean(turn.userMessage?.messageDiv.parentElement);

            try {
                turn.userMessage = createMessageElement(
                    { role: 'user', content: prompt },
                    { animate: true, forceScroll: true, isLive: isUiTurnVisible },
                );
                textArea.value = '';
                hideComposerHint();
                setHistoryDeleteButtonsDisabled(true);
                syncComposerControls();
                let responseContent = '';
                turn.assistantMessage = createMessageElement(
                    { role: 'assistant', content: '' },
                    {
                        isLive: isLiveTurn,
                        animate: true,
                        showAssistantLoader: true,
                        skipInitialRender: true,
                    },
                );

                const handleStatus = (status: ChatAgentStatus) => {
                    if (!isLiveTurn()) return;
                    if (turn.canonicalLifecycle.active) return;
                    renderAgentStatus(turn, status);
                };
                const handleProviderReasoning = (chunk: string) => {
                    if (!isLiveTurn()) return;
                    if (turn.canonicalLifecycle.active) return;
                    appendProviderReasoning(turn, chunk);
                };
                const handleTurnMetadata = (metadata: ChatTurnMemoryMetadata) => {
                    if (!isLiveTurn()) return;
                    if (turn.canonicalLifecycle.active) return;
                    turn.memoryMetadata = metadata;
                    addContextUsedItems(turn, metadata.contextUsed ?? []);
                    if (turn.assistantMessage) {
                        turn.assistantMessage.memoryMetadata = metadata;
                    }
                };
                const updateResponseContent = (content: string) => {
                    responseContent = content;
                    if (!turn.assistantMessage) {
                        turn.assistantMessage = createMessageElement(
                            { role: 'assistant', content: responseContent },
                            { animate: true, isLive: isLiveTurn, memoryMetadata: turn.memoryMetadata },
                        );
                    } else {
                        turn.assistantMessage.memoryMetadata = turn.memoryMetadata;
                        void renderMarkdownInto(turn.assistantMessage, responseContent, isLiveTurn, {
                            deferMermaid: true,
                        });
                    }
                };

                await this.chatService.streamLLM(
                    prompt,
                    (chunk) => {
                        if (!isLiveTurn()) return;
                        if (turn.canonicalLifecycle.active) return;
                        updateResponseContent(chunk);
                    },
                    controller.signal,
                    modelHistory,
                    {
                        memoryMode: "auto",
                        onLifecycleEvent: (event) => {
                            handleCanonicalLifecycleEvent(turn, event, updateResponseContent, isLiveTurn);
                        },
                        onStatus: handleStatus,
                        onReasoningChunk: handleProviderReasoning,
                        onTurnMetadata: handleTurnMetadata,
                        onEvent: (event) => {
                            if (turn.canonicalLifecycle.active) return;
                            if (event.kind === 'activity') {
                                const status = event.detail?.legacyStatus as ChatAgentStatus | undefined;
                                if (status) handleStatus(status);
                                return;
                            }
                            if (event.kind === 'reasoning-chunk') {
                                handleProviderReasoning(event.chunk);
                                return;
                            }
                            if (event.kind === 'turn-metadata') {
                                handleTurnMetadata(event.metadata);
                                return;
                            }
                            if (event.kind === 'partial-output-error') {
                                if (!isLiveTurn()) return;
                                turn.statusView ??= createThinkingStatusView(turn);
                                const content = 'Answer stopped early.';
                                if (turn.activityDetails[turn.activityDetails.length - 1] !== content) {
                                    turn.activityDetails.push(content);
                                    while (turn.activityDetails.length > 6) {
                                        turn.activityDetails.shift();
                                    }
                                }
                                appendThinkingStatus(turn.statusView, content);
                            }
                        },
                    },
                );

                if (!isLiveTurn()) return;
                await finalizeSuccessfulTurn(turn, prompt, responseContent, isLiveTurn);

            } catch (error) {
                if (!isSameTurn()) return;
                if (error instanceof DOMException && error.name === 'AbortError') {
                    createTerminalEntry(turn, 'Generation cancelled', 'cancelled');
                    this.result = previousResult;
                } else {
                    createTerminalEntry(turn, 'The answer did not finish.', 'error', String(error));
                    this.result = previousResult;
                }
            } finally {
                if (isSameTurn()) {
                    this.abortController = null;
                    this.activeTurnCancelled = false;
                    isStopping = false;
                    setHistoryDeleteButtonsDisabled(false);
                    syncComposerControls();
                }
            }
        };

        cancelButton.onclick = () => {
            if (this.abortController) {
                this.activeTurnCancelled = true;
                isStopping = true;
                this.abortController.abort();
                syncComposerControls();
                new Notice('Generation cancelled');
            }
        };

        sendButton.onclick = () => {
            void sendPrompt(textArea.value);
        };

        clearButton.onclick = async () => {
            const confirmed = await confirmChatAction(this.plugin, {
                title: 'Clear chat?',
                message: 'This clears the chat, draft, and chat history.',
                confirmText: 'Clear chat',
                danger: true,
            });
            if (!confirmed) return;
            if (!isCurrentSession()) return;
            this.invalidateActiveTurn();
            this.cancelScheduledScroll();
            this.chatHistory = [];
            timelineEntries = [];
            this.unloadAllMarkdownRenderOwners();
            this.responseDiv.empty();
            textArea.value = '';
            this.result = '';
            hideComposerHint();
            syncComposerControls();
            renderEmptyState();
            new Notice('Chat cleared');
        };

        const addContentToEditor = async (content: string) => {
            let targetLeaf = this.app.workspace.getMostRecentLeaf();
            if (!targetLeaf || !(targetLeaf.view instanceof MarkdownView)) {
                const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
                if (markdownLeaves.length > 0) {
                    targetLeaf = markdownLeaves[0];
                } else {
                    new Notice('Please open a markdown file first');
                    return;
                }
            }

            if (targetLeaf && targetLeaf.view instanceof MarkdownView && content) {
                await this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
                const editor = targetLeaf.view.editor;
                const cursor = editor.getCursor();
                editor.replaceRange(content, cursor);
                new Notice('Added response to editor');
            }
        };

        copyConversationButton.onclick = () => {
            const conversationText = timelineEntries.map((entry) => {
                if (entry.kind === 'history') {
                    return `You:\n${entry.user.content}\n\nAssistant:\n${entry.assistant.content}`;
                }
                const label = entry.terminalKind === 'error' ? 'Error' : 'Cancelled';
                return `You:\n${entry.prompt}\n\n${label}:\n${entry.content}`;
            }).join('\n\n');
            navigator.clipboard.writeText(conversationText).then(() => {
                new Notice('Conversation copied');
            }).catch(err => {
                console.error('Could not copy conversation: ', err);
            });
        };

        const composerMenuAutoClose = createIdleMenuAutoClose(composerMenu, moreButton, () => {
            composerMenu.hidden = true;
            moreButton.setAttribute('aria-expanded', 'false');
        });
        const memoryMenuAutoClose = createIdleMenuAutoClose(memoryMenu, memoryChip, closeMemoryMenu);

        moreButton.onclick = () => {
            const willOpen = composerMenu.hidden;
            if (willOpen) {
                memoryMenuAutoClose.close();
                composerMenu.hidden = false;
                moreButton.setAttribute('aria-expanded', 'true');
                composerMenuAutoClose.schedule();
            } else {
                composerMenuAutoClose.close();
            }
        };
        technicalMemoryButton.onclick = () => {
            void this.plugin.showTechnicalMemoryStatus?.();
        };
        settingsButton.onclick = () => {
            const appWithSettings = this.app as typeof this.app & {
                setting?: {
                    open: () => void;
                    openTabById: (id: string) => void;
                };
            };
            appWithSettings.setting?.open();
            appWithSettings.setting?.openTabById('personal-assistant');
        };

        memoryChip.onclick = () => {
            const willOpen = memoryMenu.hidden;
            composerMenuAutoClose.close();
            if (!willOpen) {
                memoryMenuAutoClose.close();
                return;
            }
            const requestId = ++memoryMenuRequestId;
            void renderMemoryMenu().then(() => {
                if (!isCurrentSession() || requestId !== memoryMenuRequestId) return;
                memoryMenu.hidden = false;
                memoryChip.setAttribute('aria-expanded', 'true');
                memoryMenuAutoClose.schedule();
            });
        };

        syncComposerControls();
        renderEmptyState();
        this.memoryStatusUnsubscribe = this.plugin.onMemoryStatusChanged?.(async () => {
            if (!isCurrentSession()) return;
            await refreshMemoryChipState();
        }) ?? null;
        void refreshMemoryChipState();

        // vss cache updates are now handled globally in the plugin
    }

    async onClose() {
        this.viewSessionId += 1;
        this.invalidateActiveTurn();
        this.cancelScheduledScroll();
        this.unloadAllMarkdownRenderOwners();
        this.panelResizeObserver?.disconnect();
        this.panelResizeObserver = null;
        this.disconnectStatusBarClearance();
        this.disconnectKeyboardClearance();
        this.disconnectMemoryStatusListener();
    }

    private startViewSession(): number {
        this.cancelScheduledScroll();
        this.disconnectKeyboardClearance();
        this.disconnectMemoryStatusListener();
        this.viewSessionId += 1;
        return this.viewSessionId;
    }

    private disconnectMemoryStatusListener() {
        this.memoryStatusUnsubscribe?.();
        this.memoryStatusUnsubscribe = null;
    }

    private observePanelDensity(containerEl: HTMLElement) {
        this.panelResizeObserver?.disconnect();
        this.panelResizeObserver = null;

        const panel = containerEl as HTMLElement & {
            clientWidth?: number;
            getBoundingClientRect?: () => { width: number };
        };
        const updateDensity = (observedWidth?: number) => {
            const width = observedWidth
                ?? panel.getBoundingClientRect?.().width
                ?? panel.clientWidth
                ?? 0;
            containerEl.classList.remove('is-compact', 'is-narrow', 'is-normal', 'is-wide');
            if (!width) return;
            if (width <= 360) {
                containerEl.classList.add('is-compact', 'is-narrow');
            } else if (width <= 520) {
                containerEl.classList.add('is-narrow');
            } else if (width >= 860) {
                containerEl.classList.add('is-wide');
            } else {
                containerEl.classList.add('is-normal');
            }
        };

        updateDensity();
        if (typeof ResizeObserver === 'undefined') return;

        this.panelResizeObserver = new ResizeObserver((entries) => {
            updateDensity(entries[0]?.contentRect.width);
        });
        this.panelResizeObserver.observe(containerEl);
    }

    private observeStatusBarClearance(containerEl: HTMLElement) {
        this.disconnectStatusBarClearance();

        const updateClearance = () => {
            const clearance = this.calculateStatusBarClearance(containerEl);
            containerEl.style?.setProperty('--pa-chat-status-bar-clearance', `${clearance}px`);
        };

        updateClearance();

        if (typeof ResizeObserver !== 'undefined') {
            this.statusBarResizeObserver = new ResizeObserver(updateClearance);
            this.statusBarResizeObserver.observe(containerEl);
            const statusBarEl = this.getStatusBarElement();
            if (statusBarEl) {
                this.statusBarResizeObserver.observe(statusBarEl);
            }
        }

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            this.statusBarResizeHandler = updateClearance;
            window.addEventListener('resize', updateClearance);
        }
    }

    private disconnectStatusBarClearance() {
        this.statusBarResizeObserver?.disconnect();
        this.statusBarResizeObserver = null;

        if (
            this.statusBarResizeHandler
            && typeof window !== 'undefined'
            && typeof window.removeEventListener === 'function'
        ) {
            window.removeEventListener('resize', this.statusBarResizeHandler);
        }
        this.statusBarResizeHandler = null;
    }

    private observeKeyboardClearance(containerEl: HTMLElement, inputEl: HTMLElement, onClearanceChange?: () => void) {
        this.disconnectKeyboardClearance();

        let previousClearance = -1;
        const applyClearance = (notify: boolean) => {
            const measurement = this.measureKeyboardClearance(containerEl, inputEl);
            if (measurement.hasRealKeyboardClearance) {
                this.cancelKeyboardFocusFallback();
                this.focusFallbackKeyboardHeight = 0;
            }
            const clearance = measurement.realClearance > 0
                ? measurement.realClearance
                : measurement.fallbackClearance;
            if (clearance === previousClearance) return;
            previousClearance = clearance;
            containerEl.style?.setProperty('--pa-chat-keyboard-clearance', `${clearance}px`);
            this.syncKeyboardComposerOverlay(containerEl, clearance, measurement.composerHeight);
            if (notify) {
                onClearanceChange?.();
            }
        };
        const updateClearance = () => {
            this.keyboardUpdateFrame = null;
            applyClearance(true);
        };
        const scheduleUpdate = () => {
            if (this.keyboardUpdateFrame !== null) return;
            if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                this.keyboardUpdateFrame = window.requestAnimationFrame(updateClearance);
                return;
            }
            updateClearance();
        };

        this.keyboardUpdateHandler = scheduleUpdate;
        this.keyboardVisualViewport = this.getVisualViewport();
        applyClearance(false);

        this.keyboardVisualViewport?.addEventListener('resize', scheduleUpdate);
        this.keyboardVisualViewport?.addEventListener('scroll', scheduleUpdate);

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            this.addWindowKeyboardListener('resize', scheduleUpdate);
            this.addWindowKeyboardListener('orientationchange', () => {
                this.cancelKeyboardFocusFallback();
                scheduleUpdate();
            });
        }
        this.addDocumentKeyboardListener('focusin', () => this.scheduleKeyboardFocusFallback(containerEl, scheduleUpdate));
        this.addDocumentKeyboardListener('focusout', () => this.scheduleKeyboardFocusFallbackClear(containerEl, scheduleUpdate));
        this.observeNativeKeyboardEvents(scheduleUpdate);
    }

    private disconnectKeyboardClearance() {
        if (
            this.keyboardUpdateFrame !== null
            && typeof window !== 'undefined'
            && typeof window.cancelAnimationFrame === 'function'
        ) {
            window.cancelAnimationFrame(this.keyboardUpdateFrame);
        }
        this.keyboardUpdateFrame = null;
        this.cancelKeyboardFocusFallback();

        if (this.keyboardUpdateHandler) {
            this.keyboardVisualViewport?.removeEventListener('resize', this.keyboardUpdateHandler);
            this.keyboardVisualViewport?.removeEventListener('scroll', this.keyboardUpdateHandler);
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            for (const { type, listener } of this.keyboardWindowListeners) {
                window.removeEventListener(type, listener);
            }
        }
        this.keyboardWindowListeners = [];
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            for (const { type, listener } of this.keyboardDocumentListeners) {
                document.removeEventListener(type, listener);
            }
        }
        this.keyboardDocumentListeners = [];

        for (const handle of this.keyboardPluginListenerHandles.splice(0)) {
            try {
                void handle.remove?.();
            } catch (error) {
                this.plugin.log?.('Could not remove native keyboard listener', error);
            }
        }

        this.keyboardVisualViewport = null;
        this.keyboardUpdateHandler = null;
        this.nativeKeyboardHeight = 0;
        this.focusFallbackKeyboardHeight = 0;
        this.clearKeyboardComposerOverlay(this.containerEl);
    }

    private getVisualViewport(): VisualViewport | null {
        if (typeof window === 'undefined') return null;
        return window.visualViewport ?? null;
    }

    private measureKeyboardClearance(containerEl: HTMLElement, inputEl: HTMLElement): {
        realClearance: number;
        fallbackClearance: number;
        composerHeight: number;
        hasRealKeyboardClearance: boolean;
    } {
        if (!containerEl.getBoundingClientRect) {
            return {
                realClearance: 0,
                fallbackClearance: 0,
                composerHeight: 0,
                hasRealKeyboardClearance: false,
            };
        }

        const viewRect = containerEl.getBoundingClientRect();
        const viewportOverlap = this.calculateVisualViewportKeyboardOverlap(viewRect, this.getVisualViewport());
        const nativeOverlap = this.calculateKeyboardHeightOverlap(viewRect, this.nativeKeyboardHeight);
        const fallbackOverlap = this.calculateKeyboardHeightOverlap(viewRect, this.focusFallbackKeyboardHeight);
        const realClearance = Math.max(viewportOverlap, nativeOverlap);
        const clearance = realClearance > 0 ? realClearance : fallbackOverlap;
        let composerHeight = 0;
        if (clearance > 0) {
            const composerRect = inputEl.getBoundingClientRect?.();
            composerHeight = composerRect?.height && Number.isFinite(composerRect.height)
                ? Math.ceil(composerRect.height)
                : 0;
        }

        return {
            realClearance,
            fallbackClearance: fallbackOverlap,
            composerHeight,
            hasRealKeyboardClearance: realClearance > 0,
        };
    }

    private calculateVisualViewportKeyboardOverlap(viewRect: DOMRect, viewport: VisualViewport | null): number {
        if (!viewport) return 0;

        const viewportBottom = viewport.offsetTop + viewport.height;
        if (!Number.isFinite(viewportBottom) || viewportBottom <= 0) return 0;
        const overlap = viewRect.bottom - viewportBottom;
        if (overlap <= 1) return 0;
        return Math.ceil(Math.min(overlap, viewRect.height));
    }

    private calculateKeyboardHeightOverlap(viewRect: DOMRect, keyboardHeight: number): number {
        if (keyboardHeight <= 0) return 0;

        const layoutHeight = this.getLayoutViewportHeight();
        if (layoutHeight <= 0) return Math.ceil(Math.min(keyboardHeight, viewRect.height));

        const keyboardTop = layoutHeight - keyboardHeight;
        const overlap = viewRect.bottom - keyboardTop;
        if (overlap <= 1) return 0;
        return Math.ceil(Math.min(overlap, keyboardHeight, viewRect.height));
    }

    private syncKeyboardComposerOverlay(containerEl: HTMLElement, clearance: number, composerHeight: number) {
        if (clearance <= 0) {
            this.clearKeyboardComposerOverlay(containerEl);
            return;
        }

        containerEl.style?.setProperty('--pa-chat-composer-height', `${composerHeight}px`);
        containerEl.classList.add('is-keyboard-open');
    }

    private clearKeyboardComposerOverlay(containerEl: HTMLElement) {
        containerEl.classList.remove('is-keyboard-open');
        containerEl.style?.setProperty('--pa-chat-composer-height', '0px');
    }

    private getLayoutViewportHeight(): number {
        if (typeof window !== 'undefined' && Number.isFinite(window.innerHeight) && window.innerHeight > 0) {
            return window.innerHeight;
        }
        if (typeof document !== 'undefined') {
            return document.documentElement?.clientHeight
                ?? document.body?.clientHeight
                ?? 0;
        }
        return 0;
    }

    private observeNativeKeyboardEvents(scheduleUpdate: () => void) {
        const handleShow = (source: unknown) => {
            const keyboardHeight = this.readKeyboardHeight(source);
            if (keyboardHeight > 0) {
                this.cancelKeyboardFocusFallback();
                this.nativeKeyboardHeight = keyboardHeight;
                this.focusFallbackKeyboardHeight = 0;
            }
            scheduleUpdate();
        };
        const handleHide = () => {
            this.cancelKeyboardFocusFallback();
            this.nativeKeyboardHeight = 0;
            this.focusFallbackKeyboardHeight = 0;
            scheduleUpdate();
        };

        this.addWindowKeyboardListener('keyboardWillShow', handleShow);
        this.addWindowKeyboardListener('keyboardDidShow', handleShow);
        this.addWindowKeyboardListener('keyboardWillHide', handleHide);
        this.addWindowKeyboardListener('keyboardDidHide', handleHide);

        const keyboardPlugin = this.getNativeKeyboardPlugin();
        if (!keyboardPlugin?.addListener) return;
        this.addKeyboardPluginListener(keyboardPlugin, 'keyboardWillShow', handleShow, scheduleUpdate);
        this.addKeyboardPluginListener(keyboardPlugin, 'keyboardDidShow', handleShow, scheduleUpdate);
        this.addKeyboardPluginListener(keyboardPlugin, 'keyboardWillHide', handleHide, scheduleUpdate);
        this.addKeyboardPluginListener(keyboardPlugin, 'keyboardDidHide', handleHide, scheduleUpdate);
    }

    private addWindowKeyboardListener(type: KeyboardWindowEventName, listener: (source: unknown) => void) {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
        const eventListener: EventListener = (event) => listener(event);
        window.addEventListener(type, eventListener);
        this.keyboardWindowListeners.push({ type, listener: eventListener });
    }

    private addDocumentKeyboardListener(type: KeyboardDocumentEventName, listener: (source: unknown) => void) {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
        const eventListener: EventListener = (event) => listener(event);
        document.addEventListener(type, eventListener);
        this.keyboardDocumentListeners.push({ type, listener: eventListener });
    }

    private addKeyboardPluginListener(
        keyboardPlugin: KeyboardPluginFacade,
        type: KeyboardPluginEventName,
        listener: (source: unknown) => void,
        activeHandler: () => void,
    ) {
        try {
            const handleOrPromise = keyboardPlugin.addListener?.(type, listener);
            if (!handleOrPromise) return;
            void Promise.resolve(handleOrPromise).then((handle) => {
                if (!handle) return;
                if (this.keyboardUpdateHandler !== activeHandler) {
                    void handle.remove?.();
                    return;
                }
                this.keyboardPluginListenerHandles.push(handle);
            }).catch((error) => {
                this.plugin.log?.('Could not observe native keyboard events', error);
            });
        } catch (error) {
            this.plugin.log?.('Could not observe native keyboard events', error);
        }
    }

    private getNativeKeyboardPlugin(): KeyboardPluginFacade | null {
        if (typeof window === 'undefined') return null;
        const candidate = window as typeof window & {
            Capacitor?: {
                Plugins?: {
                    Keyboard?: KeyboardPluginFacade;
                };
            };
        };
        return candidate.Capacitor?.Plugins?.Keyboard ?? null;
    }

    private scheduleKeyboardFocusFallback(containerEl: HTMLElement, scheduleUpdate: () => void) {
        this.cancelKeyboardFocusFallback();
        const focusedElement = this.getKeyboardEditableFocusedElement(containerEl);
        if (!focusedElement) return;
        if (!this.isLikelyTouchPhoneViewport()) return;
        if (this.nativeKeyboardHeight > 0) return;
        if (this.hasMeasuredKeyboardClearance(containerEl)) return;

        const token = ++this.keyboardFocusFallbackToken;
        this.keyboardFocusFallbackElement = focusedElement;
        this.keyboardFocusFallbackTimer = setTimeout(() => {
            this.keyboardFocusFallbackTimer = null;
            this.applyKeyboardFocusFallback(containerEl, focusedElement, token, scheduleUpdate);
        }, KEYBOARD_FOCUS_FALLBACK_DELAY_MS);
    }

    private scheduleKeyboardFocusFallbackClear(containerEl: HTMLElement, scheduleUpdate: () => void) {
        this.cancelKeyboardFocusFallback();
        this.keyboardFocusFallbackTimer = setTimeout(() => {
            this.keyboardFocusFallbackTimer = null;
            if (this.isKeyboardEditableFocused(containerEl)) return;
            if (this.focusFallbackKeyboardHeight === 0) return;
            this.focusFallbackKeyboardHeight = 0;
            scheduleUpdate();
        }, 120);
    }

    private clearKeyboardFocusFallbackTimer() {
        if (this.keyboardFocusFallbackTimer === null) return;
        clearTimeout(this.keyboardFocusFallbackTimer);
        this.keyboardFocusFallbackTimer = null;
    }

    private cancelKeyboardFocusFallback() {
        this.clearKeyboardFocusFallbackTimer();
        this.keyboardFocusFallbackToken += 1;
        this.keyboardFocusFallbackElement = null;
    }

    private shouldUseKeyboardFocusFallback(containerEl: HTMLElement): boolean {
        if (!this.isKeyboardEditableFocused(containerEl)) return false;
        if (!this.isLikelyTouchPhoneViewport()) return false;
        return this.nativeKeyboardHeight <= 0;
    }

    private applyKeyboardFocusFallback(
        containerEl: HTMLElement,
        focusedElement: HTMLElement,
        token: number,
        scheduleUpdate: () => void,
    ) {
        if (token !== this.keyboardFocusFallbackToken) return;
        if (this.keyboardFocusFallbackElement !== focusedElement) return;
        if (!this.isKeyboardContainerConnected(containerEl)) return;
        if (!this.isKeyboardEditableFocusedElement(containerEl, focusedElement)) return;
        if (!this.shouldUseKeyboardFocusFallback(containerEl)) return;
        if (this.hasMeasuredKeyboardClearance(containerEl)) return;

        const fallbackHeight = this.estimatePhoneKeyboardHeight();
        if (fallbackHeight <= 0 || fallbackHeight === this.focusFallbackKeyboardHeight) return;
        this.focusFallbackKeyboardHeight = fallbackHeight;
        scheduleUpdate();
    }

    private isKeyboardEditableFocused(containerEl: HTMLElement): boolean {
        return this.getKeyboardEditableFocusedElement(containerEl) !== null;
    }

    private getKeyboardEditableFocusedElement(containerEl: HTMLElement): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        const activeElement = document.activeElement as HTMLElement | null;
        if (!activeElement || !this.isKeyboardEditableFocusedElement(containerEl, activeElement)) return null;
        return activeElement;
    }

    private isKeyboardEditableFocusedElement(containerEl: HTMLElement, element: HTMLElement): boolean {
        if (!this.isElementInside(containerEl, element)) return false;
        if (!this.isKeyboardEditableElement(element)) return false;
        if (typeof document !== 'undefined' && document.activeElement !== element) return false;
        return true;
    }

    private isKeyboardEditableElement(element: HTMLElement): boolean {
        const tagName = element.tagName?.toLowerCase();
        return tagName === 'textarea'
            || tagName === 'input'
            || element.isContentEditable
            || element.getAttribute?.('contenteditable') === 'true';
    }

    private isKeyboardContainerConnected(containerEl: HTMLElement): boolean {
        const maybeConnected = (containerEl as HTMLElement & { isConnected?: boolean }).isConnected;
        return maybeConnected !== false;
    }

    private shouldFocusComposerTextArea(
        target: EventTarget | null,
        composerRow: HTMLElement,
        textArea: HTMLTextAreaElement,
    ): boolean {
        const targetElement = target as HTMLElement | null;
        if (!targetElement || typeof targetElement.tagName !== 'string') return false;

        let current: HTMLElement | null = targetElement;
        while (current) {
            if (current === textArea) return false;
            if (current !== composerRow && this.isComposerInteractiveElement(current)) return false;
            if (current === composerRow) return true;
            current = current.parentElement;
        }

        return false;
    }

    private isComposerInteractiveElement(element: HTMLElement): boolean {
        const tagName = element.tagName?.toLowerCase();
        if (tagName && ['a', 'button', 'input', 'select', 'textarea', 'option', 'summary'].includes(tagName)) {
            return true;
        }
        if (
            element.classList?.contains('llm-buttons')
            || element.classList?.contains('pa-chat-menu')
            || element.classList?.contains('pa-chat-skill-typeahead')
        ) {
            return true;
        }
        if (element.isContentEditable || element.getAttribute?.('contenteditable') === 'true') return true;

        const role = element.getAttribute?.('role');
        return Boolean(role && [
            'button',
            'checkbox',
            'link',
            'listbox',
            'menu',
            'menuitem',
            'option',
            'radio',
            'switch',
            'textbox',
        ].includes(role));
    }

    private isElementInside(root: HTMLElement, element: HTMLElement): boolean {
        let current: HTMLElement | null = element;
        while (current) {
            if (current === root) return true;
            current = current.parentElement;
        }
        return false;
    }

    private isLikelyTouchPhoneViewport(): boolean {
        if (typeof window === 'undefined') return false;
        const width = this.getLayoutViewportWidth();
        const height = this.getLayoutViewportHeight();
        const shortSide = Math.min(width || Number.POSITIVE_INFINITY, height || Number.POSITIVE_INFINITY);
        if (!Number.isFinite(shortSide) || shortSide > 520) return false;

        const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
        const touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0;
        return coarsePointer || touchPoints > 0;
    }

    private hasMeasuredKeyboardClearance(containerEl: HTMLElement): boolean {
        if (!containerEl.getBoundingClientRect) return false;
        const viewRect = containerEl.getBoundingClientRect();
        const visualOverlap = this.calculateVisualViewportKeyboardOverlap(viewRect, this.getVisualViewport());
        const nativeOverlap = this.calculateKeyboardHeightOverlap(viewRect, this.nativeKeyboardHeight);
        return Math.max(visualOverlap, nativeOverlap) > 0;
    }

    private estimatePhoneKeyboardHeight(): number {
        const layoutHeight = this.getLayoutViewportHeight();
        if (layoutHeight <= 0) return 0;
        return Math.ceil(Math.min(Math.max(layoutHeight * 0.45, 300), layoutHeight * 0.6));
    }

    private getLayoutViewportWidth(): number {
        if (typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
            return window.innerWidth;
        }
        if (typeof document !== 'undefined') {
            return document.documentElement?.clientWidth
                ?? document.body?.clientWidth
                ?? 0;
        }
        return 0;
    }

    private readKeyboardHeight(source: unknown): number {
        const value = this.readKeyboardHeightValue(source)
            ?? this.readKeyboardHeightValue((source as { detail?: unknown } | null)?.detail);
        const keyboardHeight = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(keyboardHeight) && keyboardHeight > 0 ? keyboardHeight : 0;
    }

    private readKeyboardHeightValue(source: unknown): unknown {
        if (!source || typeof source !== 'object') return undefined;
        return (source as { keyboardHeight?: unknown }).keyboardHeight;
    }

    private getStatusBarElement(): HTMLElement | null {
        if (typeof document === 'undefined') return null;
        if (typeof document.querySelector !== 'function') return null;
        return document.querySelector('.status-bar') as HTMLElement | null;
    }

    private calculateStatusBarClearance(containerEl: HTMLElement): number {
        const statusBarEl = this.getStatusBarElement();
        if (!statusBarEl || !containerEl.getBoundingClientRect || !statusBarEl.getBoundingClientRect) {
            return 0;
        }

        const viewRect = containerEl.getBoundingClientRect();
        const statusRect = statusBarEl.getBoundingClientRect();
        const horizontalOverlap = Math.max(
            0,
            Math.min(viewRect.right, statusRect.right) - Math.max(viewRect.left, statusRect.left),
        );
        const verticalOverlap = Math.max(
            0,
            Math.min(viewRect.bottom, statusRect.bottom) - Math.max(viewRect.top, statusRect.top),
        );

        if (!horizontalOverlap || !verticalOverlap) return 0;
        return Math.ceil(Math.min(statusRect.height, verticalOverlap));
    }

    private startTurn(): number {
        this.activeTurnId += 1;
        this.activeTurnCancelled = false;
        return this.activeTurnId;
    }

    private isCurrentTurn(
        sessionId: number,
        turnId: number,
        controller: AbortController,
        options: { includeCancelled?: boolean } = {},
    ): boolean {
        return this.viewSessionId === sessionId
            && this.activeTurnId === turnId
            && this.abortController === controller
            && (options.includeCancelled || !this.activeTurnCancelled);
    }

    private invalidateActiveTurn() {
        this.activeTurnId += 1;
        this.activeTurnCancelled = true;
        this.abortController?.abort();
        this.abortController = null;
    }

    private cancelScheduledScroll() {
        if (this.scheduledScrollFrame !== null) {
            window.cancelAnimationFrame(this.scheduledScrollFrame);
            this.scheduledScrollFrame = null;
        }
    }

    private updateClickableLink(containerEl: HTMLElement) {
        const links = containerEl.querySelectorAll("a.internal-link");
        links.forEach((node) => {
            const noteHref = node.getAttribute("data-href") ?? node.getAttribute("href");
            if (!noteHref || noteHref.startsWith("obsidian://")) {
                return;
            }
            const link = node as HTMLLinkElement;
            link.addEventListener("click", (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                const openInNewLeaf = this.isMemoryReferenceLink(link) || evt.metaKey || evt.ctrlKey;
                void this.openChatInternalLink(noteHref, openInNewLeaf).catch((error) => {
                    this.plugin.log?.("Could not open chat internal link", error);
                    new Notice(`Could not open note: ${noteHref}`, 4000);
                });
            });
        });
    }

    private isMemoryReferenceLink(link: HTMLElement): boolean {
        let current: HTMLElement | null = link.parentElement;
        while (current) {
            if (
                current.classList.contains('callout')
                && current.getAttribute('data-callout') === 'personal-assistant-ai'
                && /Memory references|RAG Referenc(?:es?)?/i.test(current.textContent ?? '')
            ) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    private async openChatInternalLink(noteHref: string, openInNewLeaf: boolean) {
        const workspace = this.app.workspace;
        const markdownLeaf = this.getMarkdownTargetLeaf();
        const sourcePath = workspace.getActiveFile()?.path
            ?? (markdownLeaf?.view instanceof MarkdownView ? markdownLeaf.view.file?.path : undefined)
            ?? "";

        if (!openInNewLeaf && markdownLeaf) {
            await workspace.setActiveLeaf(markdownLeaf, { focus: true });
            await workspace.openLinkText(noteHref, sourcePath, false);
            return;
        }

        await workspace.openLinkText(noteHref, sourcePath, "tab");
    }

    private getMarkdownTargetLeaf(): WorkspaceLeaf | null {
        const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
        if (mostRecentLeaf?.view instanceof MarkdownView) {
            return mostRecentLeaf;
        }
        return this.app.workspace.getLeavesOfType('markdown')[0] ?? null;
    }
}
