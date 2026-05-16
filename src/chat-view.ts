import { WorkspaceLeaf, MarkdownView, Notice, ItemView, MarkdownRenderer, setIcon, Modal, Setting, type EventRef } from 'obsidian';
import { ChatService, type ChatAgentStatus, type ChatContextUsedItem, type ChatTurnMemoryMetadata } from './ai-services/chat-service';
import type PluginManager from "./main";
import { VSS } from './vss'
import type { MemoryMaintenancePlan } from './memory-manager';

export const VIEW_TYPE_LLM = "sidellm-view";

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
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

let ldrsLoadersRequested = false;

type KeyboardPluginEventName = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardWillHide' | 'keyboardDidHide';
type KeyboardDocumentEventName = 'focusin' | 'focusout';

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
    private keyboardViewportHandler: (() => void) | null = null;
    private keyboardUpdateFrame: number | null = null;
    private keyboardWindowListeners: Array<{ type: KeyboardPluginEventName; listener: EventListener }> = [];
    private keyboardDocumentListeners: Array<{ type: KeyboardDocumentEventName; listener: EventListener }> = [];
    private keyboardPluginListenerHandles: KeyboardPluginListenerHandle[] = [];
    private keyboardFocusFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    private nativeKeyboardHeight = 0;
    private focusFallbackKeyboardHeight = 0;
    private memoryStatusUnsubscribe: (() => void) | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: PluginManager, vss: VSS) {
        super(leaf);
        this.plugin = plugin;
        this.vss = vss;
        this.chatService = new ChatService(plugin);
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

        textArea.addEventListener('keydown', (e: KeyboardEvent) => {
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
            syncComposerControls();
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
            renderedContent?: string;
            memoryMetadata?: ChatTurnMemoryMetadata;
        };
        type UiTurn = {
            id: number;
            prompt: string;
            memoryMetadata?: ChatTurnMemoryMetadata;
            contextUsedItems: ChatContextUsedItem[];
            activityDetails: string[];
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
        const hideComposerHint = () => {
            composerHint.empty();
            composerHint.hidden = true;
        };
        const showComposerHint = (message: string) => {
            composerHint.setText(message);
            composerHint.hidden = false;
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
            forceScroll = false,
        ): Promise<boolean> => {
            rendered.renderToken += 1;
            rendered.copyContent = content;
            const renderToken = rendered.renderToken;
            const buffer = createRenderBuffer();
            buffer.classList.add('message-render-buffer');

            return Promise.resolve(MarkdownRenderer.render(this.plugin.app, content, buffer, '', this.plugin))
                .then(() => {
                    if (rendered.renderToken !== renderToken || !isLive()) {
                        removeElement(buffer);
                        return false;
                    }
                    rendered.contentDiv.empty();
                    rendered.contentDiv.appendChild(buffer);
                    rendered.renderedContent = content;
                    this.updateClickableLink(buffer);
                    scrollToBottom({ force: forceScroll, behavior: forceScroll ? 'smooth' : 'auto' });
                    return true;
                })
                .catch((error) => {
                    if (rendered.renderToken !== renderToken || !isLive()) return false;
                    buffer.setText(`Could not render message: ${String(error)}`);
                    rendered.contentDiv.empty();
                    rendered.contentDiv.appendChild(buffer);
                    rendered.renderedContent = content;
                    scrollToBottom({ force: forceScroll, behavior: 'auto' });
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
                memoryMetadata: options.memoryMetadata,
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
                void renderMarkdownInto(rendered, message.content, options.isLive ?? (() => true), options.forceScroll);
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
            this.responseDiv.empty();
            historyDeleteButtons = [];
            timelineEntries.forEach((entry, entryIndex) => {
                const forceScroll = entryIndex === timelineEntries.length - 1;
                if (entry.kind === 'history') {
                    const pairStart = this.chatHistory.indexOf(entry.user);
                    if (pairStart === -1 || this.chatHistory[pairStart + 1] !== entry.assistant) return;
                    createMessageElement(entry.user, {
                        onDelete: () => deleteHistoryPair(pairStart),
                        disableDeleteWhileGenerating: true,
                    });
                    if (
                        entry.providerReasoningObserved
                        || (entry.contextUsedItems?.length ?? 0) > 0
                        || (entry.activityDetails?.length ?? 0) > 0
                    ) {
                        const statusView = createThinkingStatusView();
                        entry.activityDetails?.forEach((detail) => appendThinkingStatus(statusView, detail));
                        if (entry.providerReasoningObserved) {
                            renderProviderReasoningNotice(statusView);
                        }
                        renderContextUsedItems(statusView, entry.contextUsedItems ?? []);
                        completeThinkingStatus(statusView);
                    }
                    createMessageElement(entry.assistant, {
                        forceScroll,
                        onDelete: () => deleteHistoryPair(pairStart + 1),
                        onAddToEditor: (content) => addContentToEditor(content),
                        disableDeleteWhileGenerating: true,
                        memoryMetadata: entry.memoryMetadata,
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

        const completeThinkingStatus = (statusView: ThinkingStatusView) => {
            stopThinkingLoader(statusView);
            statusView.summaryEl.setText('Thinking complete');
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
                return [{
                    category: toolInfo.category,
                    label: toolInfo.label,
                    detail: toolInfo.detail,
                    sources: status.sources,
                    citationEligible: false,
                }];
            }
            if (status.type === 'tool-skipped') {
                const toolInfo = getToolContextUsedInfo(status.tool);
                return [{
                    category: 'tool-unavailable',
                    label: `${toolInfo.label} unavailable`,
                    detail: 'Vault context was unavailable for this turn.',
                    statusOnly: true,
                }];
            }
            if (status.type === 'web-search-enabled') {
                return [{
                    category: 'provider-web',
                    label: 'Provider web search',
                    detail: 'The AI provider may search the web. This is not Memory and no web citations are shown.',
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
                return 'Vault context unavailable';
            } else if (status.type === 'web-search-enabled') {
                return 'Qwen may search the web';
            } else if (status.type === 'answering') {
                return 'Answering...';
            } else if (status.type === 'fallback') {
                return /cap reached|stopped before/i.test(status.reason)
                    ? 'Using gathered context after reaching the planning limit.'
                    : 'Answering from available context.';
            }
            return 'Thinking...';
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

        const finalizeSuccessfulTurn = async (
            turn: UiTurn,
            prompt: string,
            responseContent: string,
            isLiveTurn: () => boolean,
        ) => {
            const userRendered = turn.userMessage;
            const assistantRendered = turn.assistantMessage;
            if (!userRendered || !assistantRendered) return false;

            assistantRendered.memoryMetadata = turn.memoryMetadata;
            if (
                responseContent
                && assistantRendered.renderedContent !== responseContent
            ) {
                const rendered = await renderMarkdownInto(assistantRendered, responseContent, isLiveTurn);
                if (!rendered || !isLiveTurn()) return false;
            }

            if (!isLiveTurn()) return false;

            const userMessage: ChatMessage = { role: 'user', content: prompt };
            const assistantMessage: ChatMessage = { role: 'assistant', content: responseContent };
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
                )
            ) {
                completeThinkingStatus(turn.statusView);
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
                    renderAgentStatus(turn, status);
                };
                const handleProviderReasoning = (chunk: string) => {
                    if (!isLiveTurn()) return;
                    appendProviderReasoning(turn, chunk);
                };
                const handleTurnMetadata = (metadata: ChatTurnMemoryMetadata) => {
                    if (!isLiveTurn()) return;
                    turn.memoryMetadata = metadata;
                    addContextUsedItems(turn, metadata.contextUsed ?? []);
                    if (turn.assistantMessage) {
                        turn.assistantMessage.memoryMetadata = metadata;
                    }
                };

                await this.chatService.streamLLM(
                    prompt,
                    (chunk) => {
                        if (!isLiveTurn()) return;
                        responseContent = chunk;
                        if (!turn.assistantMessage) {
                            turn.assistantMessage = createMessageElement(
                                { role: 'assistant', content: responseContent },
                                { animate: true, isLive: isLiveTurn, memoryMetadata: turn.memoryMetadata },
                            );
                        } else {
                            turn.assistantMessage.memoryMetadata = turn.memoryMetadata;
                            renderMarkdownInto(turn.assistantMessage, responseContent, isLiveTurn);
                        }
                    },
                    controller.signal,
                    modelHistory,
                    {
                        memoryMode: "auto",
                        onStatus: handleStatus,
                        onReasoningChunk: handleProviderReasoning,
                        onTurnMetadata: handleTurnMetadata,
                        onEvent: (event) => {
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
            this.clearKeyboardFocusFallbackIfMeasured(containerEl);
            const clearance = this.calculateKeyboardClearance(containerEl);
            if (clearance === previousClearance) return;
            previousClearance = clearance;
            containerEl.style?.setProperty('--pa-chat-keyboard-clearance', `${clearance}px`);
            this.syncKeyboardComposerOverlay(containerEl, inputEl, clearance);
            if (notify) {
                onClearanceChange?.();
            }
        };
        const updateClearance = () => {
            this.keyboardUpdateFrame = null;
            applyClearance(true);
        };
        const updateClearanceNow = () => {
            if (
                this.keyboardUpdateFrame !== null
                && typeof window !== 'undefined'
                && typeof window.cancelAnimationFrame === 'function'
            ) {
                window.cancelAnimationFrame(this.keyboardUpdateFrame);
                this.keyboardUpdateFrame = null;
            }
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

        this.keyboardViewportHandler = scheduleUpdate;
        this.keyboardVisualViewport = this.getVisualViewport();
        applyClearance(false);

        this.keyboardVisualViewport?.addEventListener('resize', scheduleUpdate);
        this.keyboardVisualViewport?.addEventListener('scroll', scheduleUpdate);

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('resize', scheduleUpdate);
            window.addEventListener('orientationchange', scheduleUpdate);
        }
        this.addDocumentKeyboardListener('focusin', scheduleUpdate);
        this.addDocumentKeyboardListener('focusout', scheduleUpdate);
        this.addDocumentKeyboardListener('focusin', () => this.scheduleKeyboardFocusFallback(containerEl, updateClearanceNow));
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
        this.clearKeyboardFocusFallbackTimer();

        if (this.keyboardViewportHandler) {
            this.keyboardVisualViewport?.removeEventListener('resize', this.keyboardViewportHandler);
            this.keyboardVisualViewport?.removeEventListener('scroll', this.keyboardViewportHandler);

            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
                window.removeEventListener('resize', this.keyboardViewportHandler);
                window.removeEventListener('orientationchange', this.keyboardViewportHandler);
            }
            if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
                document.removeEventListener('focusin', this.keyboardViewportHandler);
                document.removeEventListener('focusout', this.keyboardViewportHandler);
            }
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
        this.keyboardViewportHandler = null;
        this.nativeKeyboardHeight = 0;
        this.focusFallbackKeyboardHeight = 0;
        this.clearKeyboardComposerOverlay(this.containerEl);
    }

    private getVisualViewport(): VisualViewport | null {
        if (typeof window === 'undefined') return null;
        return window.visualViewport ?? null;
    }

    private calculateKeyboardClearance(containerEl: HTMLElement): number {
        const viewport = this.getVisualViewport();
        if (!containerEl.getBoundingClientRect) return 0;

        const viewRect = containerEl.getBoundingClientRect();
        const viewportOverlap = this.calculateVisualViewportKeyboardOverlap(viewRect, viewport);
        const nativeOverlap = this.calculateKeyboardHeightOverlap(viewRect, this.getEffectiveNativeKeyboardHeight());
        return Math.max(viewportOverlap, nativeOverlap);
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

    private syncKeyboardComposerOverlay(containerEl: HTMLElement, inputEl: HTMLElement, clearance: number) {
        if (clearance <= 0) {
            this.clearKeyboardComposerOverlay(containerEl);
            return;
        }

        const composerRect = inputEl.getBoundingClientRect?.();
        const composerHeight = composerRect?.height && Number.isFinite(composerRect.height)
            ? Math.ceil(composerRect.height)
            : 0;
        containerEl.style?.setProperty('--pa-chat-composer-height', `${composerHeight}px`);
        containerEl.classList.add('is-keyboard-open');
    }

    private clearKeyboardComposerOverlay(containerEl: HTMLElement) {
        containerEl.classList.remove('is-keyboard-open');
        containerEl.style?.setProperty('--pa-chat-composer-height', '0px');
    }

    private getEffectiveNativeKeyboardHeight(): number {
        return Math.max(this.nativeKeyboardHeight, this.focusFallbackKeyboardHeight);
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
                this.nativeKeyboardHeight = keyboardHeight;
                this.focusFallbackKeyboardHeight = 0;
            }
            scheduleUpdate();
        };
        const handleHide = () => {
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

    private addWindowKeyboardListener(type: KeyboardPluginEventName, listener: (source: unknown) => void) {
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
                if (this.keyboardViewportHandler !== activeHandler) {
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
        this.clearKeyboardFocusFallbackTimer();
        this.applyKeyboardFocusFallback(containerEl, scheduleUpdate);

        this.keyboardFocusFallbackTimer = setTimeout(() => {
            this.keyboardFocusFallbackTimer = null;
            this.applyKeyboardFocusFallback(containerEl, scheduleUpdate);
        }, 120);
    }

    private scheduleKeyboardFocusFallbackClear(containerEl: HTMLElement, scheduleUpdate: () => void) {
        this.clearKeyboardFocusFallbackTimer();
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

    private shouldUseKeyboardFocusFallback(containerEl: HTMLElement): boolean {
        if (!this.isKeyboardEditableFocused(containerEl)) return false;
        if (!this.isLikelyTouchPhoneViewport()) return false;
        return this.nativeKeyboardHeight <= 0;
    }

    private applyKeyboardFocusFallback(containerEl: HTMLElement, scheduleUpdate: () => void) {
        if (!this.shouldUseKeyboardFocusFallback(containerEl)) return;
        if (this.hasMeasuredKeyboardClearance(containerEl)) return;

        const fallbackHeight = this.estimatePhoneKeyboardHeight();
        if (fallbackHeight <= 0 || fallbackHeight === this.focusFallbackKeyboardHeight) return;
        this.focusFallbackKeyboardHeight = fallbackHeight;
        scheduleUpdate();
    }

    private clearKeyboardFocusFallbackIfMeasured(containerEl: HTMLElement) {
        if (this.focusFallbackKeyboardHeight === 0) return;
        if (!this.hasMeasuredKeyboardClearance(containerEl)) return;
        this.focusFallbackKeyboardHeight = 0;
    }

    private isKeyboardEditableFocused(containerEl: HTMLElement): boolean {
        if (typeof document === 'undefined') return false;
        const activeElement = document.activeElement as HTMLElement | null;
        if (!activeElement || !this.isElementInside(containerEl, activeElement)) return false;
        return this.isKeyboardEditableElement(activeElement);
    }

    private isKeyboardEditableElement(element: HTMLElement): boolean {
        const tagName = element.tagName?.toLowerCase();
        return tagName === 'textarea'
            || tagName === 'input'
            || element.isContentEditable
            || element.getAttribute?.('contenteditable') === 'true';
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
