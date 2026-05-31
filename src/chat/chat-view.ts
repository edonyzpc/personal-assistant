import { WorkspaceLeaf, MarkdownView, Notice, ItemView, setIcon, Component, Platform, type EventRef } from 'obsidian';
import { ChatService, type AgentEvent, type ChatAgentStatus, type ChatContextUsedItem, type ChatMessage, type ChatTurnMemoryMetadata } from '../ai-services/chat-service';
import { BUNDLED_SKILL_CATALOG } from '../ai-services/bundled-skill-catalog';
import { createPaAgentPersistedTurn, readChatHistoryTurnMetadata } from '../ai-services/pa-agent-history';
import type { PaAgentMessage, PaAgentPersistedTurn, TurnEndStatus } from '../ai-services/chat-types';
import type PluginManager from "../main";
import { VSS } from '../vss'
import type { MemoryMaintenancePlan } from '../memory-manager';
import type { ThinkingStatusView, RenderedMessage, RuntimeWarningViewItem, CanonicalLifecycleUiState, UiTurn, TerminalTurnEntry, TimelineEntry } from './types';
import { confirmChatAction, pickChatConversation } from './modals';
import type { ChatHistoryManager } from './chat-history-manager';
import type { PersistedConversation, PersistedTurn } from './chat-history-store';
import { renderMarkdownWithOwner, containsMermaidFence, deferMermaidFences, getMermaidFenceSources, scheduleMermaidEnhancement, renderMermaidSourceWarning } from './mermaid';
import { CHAT_MENU_IDLE_CLOSE_MS, createChatMenuItem, createChatMenuDivider, createChatMenuLabel } from './menu-helpers';
import { formatSourceSummary, mergeContextUsedItems, normalizeContextUsedItems, normalizeSourceRecords, mergeSourceRecords, getContextUsedItemsFromStatus, formatAgentStatus, formatCanonicalToolStatus, formatCanonicalToolCompletedStatus, formatRuntimeWarningLabel, formatRuntimeWarningDetail, formatCanonicalTerminalSummary, runtimeWarningKey } from './formatters';
import {
    createChatRoleIdenticonSessionSeed,
    getChatRoleIdenticonModel,
    type ChatRoleIdenticon,
    type ChatRoleIdenticonModel,
} from './role-identicons';

export const VIEW_TYPE_LLM = "sidellm-view";
export type { ChatMessage };

const LIVE_MARKDOWN_SLOW_RENDER_MS = 12;
const LIVE_MARKDOWN_RENDER_COOLDOWN_MS = 32;

const getMonotonicTimeMs = () => {
    const performanceApi = globalThis.performance;
    return typeof performanceApi?.now === 'function' ? performanceApi.now() : Date.now();
};

type MarkdownRenderOptions = {
    forceScroll?: boolean;
    deferMermaid?: boolean;
    onSynchronousRenderComplete?: (durationMs: number) => void;
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
export { CHAT_MENU_IDLE_CLOSE_MS } from './menu-helpers';

let ldrsLoadersRequested = false;

type KeyboardPluginEventName = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardWillHide' | 'keyboardDidHide';
type KeyboardWindowEventName = KeyboardPluginEventName | 'resize' | 'orientationchange';

interface KeyboardPluginInfo {
    keyboardHeight?: number;
}

interface KeyboardPluginListenerHandle {
    remove?: () => Promise<void> | void;
}

// Capacitor Keyboard plugin facade. We rely on:
//   - addListener: observe keyboard show/hide for diagnostics + immediate JS-side scheduleUpdate
//   - setResizeMode({mode: 'body'}): let Capacitor itself manage layout viewport resize so the
//     250-400ms race between keyboardWillShow and visualViewport.resize is owned by the WebView.
// Combined with CSS env(keyboard-inset-height, 0px) fallback in setKeyboardClearanceStyles, this
// eliminates the need for JS-side keyboard height estimation.
interface KeyboardPluginFacade {
    addListener?: (
        eventName: KeyboardPluginEventName,
        listenerFunc: (info: KeyboardPluginInfo) => void,
    ) => Promise<KeyboardPluginListenerHandle> | KeyboardPluginListenerHandle;
    setResizeMode?: (options: { mode: string }) => Promise<void> | void;
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
    private keyboardPluginListenerHandles: KeyboardPluginListenerHandle[] = [];
    private nativeKeyboardHeight = 0;
    private memoryStatusUnsubscribe: (() => void) | null = null;
    private markdownRenderOwners = new Set<Component>();
    private mobileTabBarHandle: HTMLElement | null = null;
    private mobileTabBarOptions: HTMLElement | null = null;
    private mobileTabBarOptionsHandler: (() => void) | null = null;
    private mobileTabBarDismissTimer: ReturnType<typeof setTimeout> | null = null;
    private activeConversationId: string | null = null;
    private activeConversation: PersistedConversation | null = null;
    private nextTurnIndex = 0;
    private persistedTurnIndexByEntry = new WeakMap<TimelineEntry, number>();
    private persistChain: Promise<void> = Promise.resolve();

    get isStreaming(): boolean {
        return this.abortController !== null;
    }

    constructor(leaf: WorkspaceLeaf, plugin: PluginManager, vss: VSS) {
        super(leaf);
        this.plugin = plugin;
        this.vss = vss;
        this.chatService = new ChatService(plugin);
    }

    private getChatHistoryManager(): ChatHistoryManager | undefined {
        return this.plugin.chatHistoryManager;
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
        const roleIdenticonSessionSeed = createChatRoleIdenticonSessionSeed();
        ensureChatLoadersRegistered((message, error) => this.plugin.log(message, error));
        const { containerEl } = this;
        containerEl.empty();
        containerEl.classList.add('llm-view');
        this.observePanelDensity(containerEl);
        this.observeStatusBarClearance(containerEl);

        const chatContainer = containerEl.createDiv({ cls: 'llm-chat-container' });

        const inputDiv = containerEl.createDiv({ cls: 'llm-input' });
        this.setupMobileTabBarAutoHide(containerEl);
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
        const primeComposerTextAreaFocus = (event: Event) => {
            if (event.defaultPrevented) return;
            if (!this.shouldFocusComposerTextArea(event.target, composerRow, textArea, true)) return;
            this.focusComposerTextArea(textArea);
        };
        composerRow.addEventListener('pointerdown', primeComposerTextAreaFocus, { passive: true });
        composerRow.addEventListener('touchstart', primeComposerTextAreaFocus, { passive: true });
        composerRow.addEventListener('click', (event) => {
            if (event.defaultPrevented) return;
            if (!this.shouldFocusComposerTextArea(event.target, composerRow, textArea, false)) return;
            this.focusComposerTextArea(textArea);
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
        const newChatButton = createChatMenuItem(composerMenu, {
            text: 'New Chat',
            icon: 'plus-square',
        });
        const historyButton = createChatMenuItem(composerMenu, {
            text: 'History',
            icon: 'history',
        });
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


        let uiTurnId = 0;
        let thinkingStatusId = 0;
        let historyDeleteButtons: HTMLButtonElement[] = [];
        let timelineEntries: TimelineEntry[] = [];
        let emptyStateEl: HTMLElement | null = null;
        let isStopping = false;
        let isFinalizing = false;

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
            const setupIssue = this.plugin.getAISetupIssue?.() ?? null;
            sendButton.disabled = generating || !hasDraft || setupIssue !== null;
            if (generating && !isStopping && !isFinalizing) {
                textArea.setAttribute('placeholder', 'Draft next message');
                sendButton.classList.replace('send-button-visible', 'send-button-hidden');
                cancelButton.classList.replace('cancel-button-hidden', 'cancel-button-visible');
            } else {
                textArea.setAttribute(
                    'placeholder',
                    generating ? 'Draft next message' : setupIssue ? 'Set up AI provider first' : 'Ask about your notes...',
                );
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
        const createSvgChild = (parent: Element, tagName: string): Element => {
            if (typeof document !== 'undefined' && typeof document.createElementNS === 'function') {
                return document.createElementNS('http://www.w3.org/2000/svg', tagName);
            }
            const fallbackParent = parent as Element & { createEl?: (tagName: string) => HTMLElement };
            if (typeof fallbackParent.createEl === 'function') {
                return fallbackParent.createEl(tagName) as unknown as Element;
            }
            return document.createElement(tagName);
        };
        const createRoleIdenticon = (
            parent: HTMLElement,
            role: ChatRoleIdenticon,
            model: ChatRoleIdenticonModel,
        ) => {
            const identiconEl = parent.createSpan({
                cls: `pa-chat-role-identicon pa-chat-role-identicon-${role}`,
                attr: { 'aria-hidden': 'true' },
            });
            identiconEl.style.setProperty('--pa-chat-role-identicon-fill', model.fill);
            identiconEl.style.setProperty('--pa-chat-role-identicon-active-fill', model.activeFill);

            const svgEl = createSvgChild(identiconEl, 'svg');
            svgEl.classList.add('pa-chat-role-identicon-svg');
            svgEl.setAttribute('class', 'pa-chat-role-identicon-svg');
            svgEl.setAttribute('viewBox', model.viewBox);
            svgEl.setAttribute('fill', 'currentColor');
            svgEl.setAttribute('focusable', 'false');
            identiconEl.appendChild(svgEl);

            for (const cell of model.cells) {
                const rectEl = createSvgChild(svgEl, 'rect');
                rectEl.classList.add('pa-chat-role-identicon-cell');
                rectEl.setAttribute('class', 'pa-chat-role-identicon-cell');
                rectEl.setAttribute('x', String(cell.x));
                rectEl.setAttribute('y', String(cell.y));
                rectEl.setAttribute('width', '1');
                rectEl.setAttribute('height', '1');
                rectEl.setAttribute('fill', 'currentColor');
                svgEl.appendChild(rectEl);
            }
        };
        const createRoleLabel = (
            parent: HTMLElement,
            text: string,
            options: {
                extraClass?: string;
                identicon?: ChatRoleIdenticon;
                loader?: 'thinking' | 'assistant';
            } = {},
        ): { roleEl: HTMLElement; loaderEl?: HTMLElement } => {
            const roleEl = parent.createDiv({
                cls: ['message-role', options.extraClass ?? ''].filter(Boolean).join(' '),
            });
            if (options.identicon) {
                createRoleIdenticon(
                    roleEl,
                    options.identicon,
                    getChatRoleIdenticonModel(options.identicon, roleIdenticonSessionSeed),
                );
            }
            const loaderEl = !options.identicon && options.loader ? createRoleLoader(roleEl, options.loader) : undefined;
            roleEl.createSpan({ cls: 'pa-chat-role-text', text });
            return {
                roleEl,
                loaderEl: options.identicon && options.loader ? createRoleLoader(roleEl, options.loader) : loaderEl,
            };
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

            const renderStartedAt = getMonotonicTimeMs();
            const renderPromise = renderMarkdownWithOwner(this.plugin, mermaidTransform.markdown, buffer, renderOwner);
            options.onSynchronousRenderComplete?.(getMonotonicTimeMs() - renderStartedAt);

            return renderPromise
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

        type LiveMarkdownRenderState = {
            inFlight: boolean;
            inFlightContent?: string;
            inFlightPromise?: Promise<boolean>;
            pendingContent?: string;
            pendingForceScroll?: boolean;
            scheduledDrainTimer?: ReturnType<typeof setTimeout>;
            nextRenderAfterMs?: number;
        };
        const liveMarkdownRenderStates = new WeakMap<RenderedMessage, LiveMarkdownRenderState>();
        const getLiveMarkdownRenderState = (rendered: RenderedMessage): LiveMarkdownRenderState => {
            let state = liveMarkdownRenderStates.get(rendered);
            if (!state) {
                state = { inFlight: false };
                liveMarkdownRenderStates.set(rendered, state);
            }
            return state;
        };
        function clearScheduledLiveMarkdownDrain(state: LiveMarkdownRenderState) {
            if (state.scheduledDrainTimer === undefined) return;
            clearTimeout(state.scheduledDrainTimer);
            state.scheduledDrainTimer = undefined;
        }
        function scheduleLiveMarkdownDrain(
            rendered: RenderedMessage,
            state: LiveMarkdownRenderState,
            isLive: () => boolean,
            delayMs: number,
            options: { forceScroll?: boolean } = {},
        ) {
            if (state.scheduledDrainTimer !== undefined) return;
            state.scheduledDrainTimer = setTimeout(() => {
                state.scheduledDrainTimer = undefined;
                runLiveMarkdownRender(rendered, state, isLive, options);
            }, delayMs);
        }
        function runLiveMarkdownRender(
            rendered: RenderedMessage,
            state: LiveMarkdownRenderState,
            isLive: () => boolean,
            options: { forceScroll?: boolean } = {},
        ) {
            if (state.inFlight || !isLive()) return;
            if (state.scheduledDrainTimer !== undefined) return;
            const content = state.pendingContent;
            if (content === undefined) return;
            const delayMs = Math.max(0, (state.nextRenderAfterMs ?? 0) - getMonotonicTimeMs());
            if (delayMs > 0) {
                scheduleLiveMarkdownDrain(rendered, state, isLive, delayMs, options);
                return;
            }
            state.pendingContent = undefined;
            const forceScroll = state.pendingForceScroll || options.forceScroll;
            state.pendingForceScroll = false;
            state.inFlight = true;
            state.inFlightContent = content;
            let synchronousRenderDurationMs = 0;
            const isCurrentLiveMarkdownRender = () => {
                if (!isLive()) return false;
                const pending = state.pendingContent;
                return pending === undefined || pending.startsWith(content);
            };
            const renderPromise = renderMarkdownInto(rendered, content, isCurrentLiveMarkdownRender, {
                deferMermaid: true,
                forceScroll,
                onSynchronousRenderComplete: (durationMs) => {
                    synchronousRenderDurationMs = durationMs;
                },
            });
            state.inFlightPromise = renderPromise;
            void renderPromise.finally(() => {
                state.inFlight = false;
                state.inFlightContent = undefined;
                state.inFlightPromise = undefined;
                if (synchronousRenderDurationMs >= LIVE_MARKDOWN_SLOW_RENDER_MS) {
                    state.nextRenderAfterMs = getMonotonicTimeMs() + LIVE_MARKDOWN_RENDER_COOLDOWN_MS;
                } else if ((state.nextRenderAfterMs ?? 0) <= getMonotonicTimeMs()) {
                    state.nextRenderAfterMs = undefined;
                }
                if (!isLive()) {
                    clearScheduledLiveMarkdownDrain(state);
                    state.pendingContent = undefined;
                    state.pendingForceScroll = false;
                    return;
                }
                if (state.pendingContent !== undefined && state.pendingContent !== rendered.renderedContent) {
                    runLiveMarkdownRender(rendered, state, isLive, options);
                }
            });
        }
        const renderLiveMarkdownInto = (
            rendered: RenderedMessage,
            content: string,
            isLive: () => boolean,
            options: { forceScroll?: boolean } = {},
        ) => {
            rendered.copyContent = content;
            const state = getLiveMarkdownRenderState(rendered);
            state.pendingContent = content;
            state.pendingForceScroll = Boolean(state.pendingForceScroll || options.forceScroll);
            runLiveMarkdownRender(rendered, state, isLive, options);
        };
        const settleLiveMarkdownRenderBeforeFinal = async (
            rendered: RenderedMessage,
            finalContent: string,
            isLive: () => boolean,
        ) => {
            const state = liveMarkdownRenderStates.get(rendered);
            if (!state) return true;
            clearScheduledLiveMarkdownDrain(state);
            state.pendingContent = undefined;
            state.pendingForceScroll = false;
            state.nextRenderAfterMs = undefined;
            const inFlightPromise = state.inFlightPromise;
            if (!inFlightPromise || state.inFlightContent !== finalContent) return true;
            const renderedLive = await inFlightPromise;
            return renderedLive && isLive();
        };
        const cancelPendingLiveMarkdownRender = (rendered?: RenderedMessage) => {
            if (!rendered) return;
            const state = liveMarkdownRenderStates.get(rendered);
            if (!state) return;
            clearScheduledLiveMarkdownDrain(state);
            state.pendingContent = undefined;
            state.pendingForceScroll = false;
            state.nextRenderAfterMs = undefined;
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
                identicon: message.role,
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
            const removedEntries: TimelineEntry[] = [];
            timelineEntries = timelineEntries.filter((entry) => {
                const keep = entry.kind !== 'history' || entry.user !== expectedUser || entry.assistant !== expectedAssistant;
                if (!keep) removedEntries.push(entry);
                return keep;
            });
            renderTimeline();
            for (const entry of removedEntries) {
                void this.deletePersistedTurnForEntry(entry);
            }
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
            const liveRenderSettled = await settleLiveMarkdownRenderBeforeFinal(
                assistantRendered,
                responseContent,
                isLiveTurn,
            );
            if (!liveRenderSettled || !isLiveTurn()) return false;
            cancelPendingLiveMarkdownRender(assistantRendered);
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
            const historyEntry: TimelineEntry = {
                kind: 'history',
                user: userMessage,
                assistant: assistantMessage,
                memoryMetadata: turn.memoryMetadata,
                contextUsedItems: turn.contextUsedItems,
                activityDetails: turn.activityDetails,
                providerReasoningObserved: turn.providerReasoningObserved,
            };
            timelineEntries.push(historyEntry);
            this.result = responseContent;
            await this.persistFinalizedTurn(prompt, historyEntry);

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
            const setupIssue = this.plugin.getAISetupIssue?.() ?? null;
            if (setupIssue) {
                showComposerHint(setupIssue);
                syncComposerControls();
                return;
            }
            isStopping = false;
            isFinalizing = false;
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
                            {
                                animate: true,
                                isLive: isLiveTurn,
                                memoryMetadata: turn.memoryMetadata,
                                skipInitialRender: true,
                            },
                        );
                    } else {
                        turn.assistantMessage.memoryMetadata = turn.memoryMetadata;
                    }
                    renderLiveMarkdownInto(turn.assistantMessage, responseContent, isLiveTurn);
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
                isFinalizing = true;
                syncComposerControls();
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
                    isFinalizing = false;
                    setHistoryDeleteButtonsDisabled(false);
                    syncComposerControls();
                }
            }
        };

        cancelButton.onclick = () => {
            if (this.abortController && !isFinalizing) {
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
                title: 'Clear current chat?',
                message: 'This clears the current chat and draft. Other saved conversations remain in History.',
                confirmText: 'Clear current chat',
                danger: true,
            });
            if (!confirmed) return;
            if (!isCurrentSession()) return;
            await this.persistChain.catch(() => undefined);
            this.invalidateActiveTurn();
            isStopping = false;
            isFinalizing = false;
            this.cancelScheduledScroll();
            const conversationIdToDelete = this.activeConversationId;
            this.chatHistory = [];
            timelineEntries = [];
            this.activeConversation = null;
            this.activeConversationId = null;
            this.nextTurnIndex = 0;
            this.unloadAllMarkdownRenderOwners();
            this.responseDiv.empty();
            textArea.value = '';
            this.result = '';
            hideComposerHint();
            syncComposerControls();
            renderEmptyState();
            const manager = await getReadyHistoryManager();
            if (manager && conversationIdToDelete) {
                try {
                    await manager.deleteConversation(conversationIdToDelete);
                } catch (error) {
                    this.plugin.log?.("Failed to delete cleared conversation", error);
                }
            } else if (manager) {
                try {
                    await manager.setActiveConversationId(null);
                } catch (error) {
                    this.plugin.log?.("Failed to clear active conversation pointer", error);
                }
            }
            new Notice('Current chat cleared');
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

        const applyRestoredConversation = (
            conversation: PersistedConversation,
            turns: PersistedTurn[],
        ) => {
            const manager = this.getChatHistoryManager();
            if (!manager) return;
            this.invalidateActiveTurn();
            isStopping = false;
            isFinalizing = false;
            this.cancelScheduledScroll();
            this.chatHistory = [];
            timelineEntries = [];
            let maxTurnIndex = -1;
            for (const turn of turns) {
                const rehydrated = manager.deserializeTurn(turn);
                this.chatHistory.push(rehydrated.userMessage, rehydrated.assistantMessage);
                timelineEntries.push(rehydrated.historyEntry);
                this.persistedTurnIndexByEntry.set(rehydrated.historyEntry, turn.turnIndex);
                if (turn.turnIndex > maxTurnIndex) maxTurnIndex = turn.turnIndex;
            }
            this.activeConversation = conversation;
            this.activeConversationId = conversation.id;
            this.nextTurnIndex = maxTurnIndex + 1;
            this.unloadAllMarkdownRenderOwners();
            this.responseDiv.empty();
            this.result = '';
            renderTimeline();
        };
        const getReadyHistoryManager = async (showNotice = false): Promise<ChatHistoryManager | null> => {
            const manager = this.getChatHistoryManager();
            if (!manager) {
                if (showNotice) new Notice('Chat history is unavailable.');
                return null;
            }
            await manager.initialize();
            if (!manager.isAvailable()) {
                if (showNotice) new Notice('Chat history is unavailable.');
                return null;
            }
            return manager;
        };

        const restoreActiveConversation = async () => {
            try {
                const manager = await getReadyHistoryManager();
                if (!manager) return;
                const activeId = await manager.getActiveConversationId();
                if (!activeId) return;
                if (!isCurrentSession()) return;
                if (isGenerating() || this.chatHistory.length > 0) return;
                const conversation = await manager.findConversation(activeId);
                if (!conversation) {
                    await manager.setActiveConversationId(null);
                    return;
                }
                if (!isCurrentSession()) return;
                if (isGenerating() || this.chatHistory.length > 0) return;
                const turns = await manager.getTurns(activeId);
                if (!isCurrentSession()) return;
                if (isGenerating() || this.chatHistory.length > 0) return;
                applyRestoredConversation(conversation, turns);
            } catch (error) {
                this.plugin.log?.("Failed to restore chat history", error);
            }
        };

        const switchActiveConversation = async (conversationId: string) => {
            if (isGenerating()) {
                new Notice('Wait for the current response to finish before switching conversations.');
                return;
            }
            await this.persistChain.catch(() => undefined);
            const manager = await getReadyHistoryManager(true);
            if (!manager) return;
            try {
                const conversation = await manager.findConversation(conversationId);
                if (!conversation) {
                    new Notice('Conversation no longer exists.');
                    return;
                }
                if (!isCurrentSession()) return;
                if (isGenerating()) {
                    new Notice('Wait for the current response to finish before switching conversations.');
                    return;
                }
                await manager.setActiveConversationId(conversationId);
                const turns = await manager.getTurns(conversationId);
                if (!isCurrentSession()) return;
                applyRestoredConversation(conversation, turns);
            } catch (error) {
                this.plugin.log?.("Failed to switch chat conversation", error);
                new Notice('Could not load that conversation.');
            }
        };

        const startNewConversation = async () => {
            if (isGenerating()) {
                new Notice('Wait for the current response to finish before starting a new chat.');
                return;
            }
            await this.persistChain.catch(() => undefined);
            this.invalidateActiveTurn();
            isStopping = false;
            isFinalizing = false;
            this.cancelScheduledScroll();
            this.chatHistory = [];
            timelineEntries = [];
            this.activeConversation = null;
            this.activeConversationId = null;
            this.nextTurnIndex = 0;
            this.unloadAllMarkdownRenderOwners();
            this.responseDiv.empty();
            textArea.value = '';
            this.result = '';
            hideComposerHint();
            syncComposerControls();
            renderEmptyState();
            const manager = await getReadyHistoryManager();
            if (manager) {
                try {
                    await manager.setActiveConversationId(null);
                } catch (error) {
                    this.plugin.log?.("Failed to clear active conversation pointer", error);
                }
            }
            new Notice('Started a new chat');
        };

        const openHistoryPicker = async () => {
            const manager = await getReadyHistoryManager(true);
            if (!manager) return;
            try {
                const conversations = await manager.listConversations();
                if (!isCurrentSession()) return;
                conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
                const selection = await pickChatConversation(this.plugin, {
                    conversations,
                    activeConversationId: this.activeConversationId,
                    isStreaming: this.isStreaming,
                });
                if (!selection) return;
                if (!isCurrentSession()) return;
                if (selection.action === 'open') {
                    await switchActiveConversation(selection.conversationId);
                    return;
                }
                if (selection.action === 'delete') {
                    const confirmed = await confirmChatAction(this.plugin, {
                        title: 'Delete conversation?',
                        message: 'This deletes the conversation and all its turns. This cannot be undone.',
                        confirmText: 'Delete',
                        danger: true,
                    });
                    if (!confirmed) return;
                    if (!isCurrentSession()) return;
                    await manager.deleteConversation(selection.conversationId);
                    if (!isCurrentSession()) return;
                    if (selection.conversationId === this.activeConversationId) {
                        await startNewConversation();
                    } else {
                        new Notice('Conversation deleted');
                    }
                }
            } catch (error) {
                this.plugin.log?.("Failed to open chat history picker", error);
                new Notice('Could not open chat history.');
            }
        };

        newChatButton.onclick = () => {
            composerMenuAutoClose.close();
            void startNewConversation();
        };
        historyButton.onclick = () => {
            composerMenuAutoClose.close();
            void openHistoryPicker();
        };

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
        void restoreActiveConversation();
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
        this.teardownMobileTabBarAutoHide();
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

    private setupMobileTabBarAutoHide(containerEl: HTMLElement) {
        this.teardownMobileTabBarAutoHide();
        if (!Platform.isMobile) return;
        const tabContainer = containerEl.closest('.workspace-drawer-tab-container');
        if (!tabContainer) return;
        const tabOptions = tabContainer.querySelector<HTMLElement>('.workspace-drawer-tab-options');
        if (!tabOptions) return;
        this.mobileTabBarOptions = tabOptions;

        const handle = document.createElement('div');
        handle.className = 'pa-tab-bar-handle';
        handle.setAttribute('aria-label', 'Show tab bar');
        handle.setAttribute('aria-expanded', 'false');
        setIcon(handle, 'chevron-up');
        containerEl.appendChild(handle);
        this.mobileTabBarHandle = handle;

        const dismiss = () => {
            tabOptions.classList.remove('pa-tab-bar-visible');
            setIcon(handle, 'chevron-up');
            handle.setAttribute('aria-label', 'Show tab bar');
            handle.setAttribute('aria-expanded', 'false');
        };
        const scheduleDismiss = () => {
            this.clearMobileTabBarDismissTimer();
            this.mobileTabBarDismissTimer = setTimeout(dismiss, 5000);
        };

        handle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tabOptions.classList.contains('pa-tab-bar-visible')) {
                this.clearMobileTabBarDismissTimer();
                dismiss();
            } else {
                tabOptions.classList.add('pa-tab-bar-visible');
                setIcon(handle, 'chevron-down');
                handle.setAttribute('aria-label', 'Hide tab bar');
                handle.setAttribute('aria-expanded', 'true');
                scheduleDismiss();
            }
        });

        const tabOptionsHandler = () => {
            this.clearMobileTabBarDismissTimer();
            scheduleDismiss();
        };
        tabOptions.addEventListener('click', tabOptionsHandler);
        this.mobileTabBarOptionsHandler = tabOptionsHandler;
    }

    private teardownMobileTabBarAutoHide() {
        this.clearMobileTabBarDismissTimer();
        if (this.mobileTabBarOptions && this.mobileTabBarOptionsHandler) {
            this.mobileTabBarOptions.removeEventListener('click', this.mobileTabBarOptionsHandler);
        }
        this.mobileTabBarOptionsHandler = null;
        this.mobileTabBarOptions?.classList.remove('pa-tab-bar-visible');
        this.mobileTabBarOptions = null;
        this.mobileTabBarHandle?.remove();
        this.mobileTabBarHandle = null;
    }

    private clearMobileTabBarDismissTimer() {
        if (this.mobileTabBarDismissTimer !== null) {
            clearTimeout(this.mobileTabBarDismissTimer);
            this.mobileTabBarDismissTimer = null;
        }
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
            const clearance = measurement.realClearance;
            if (clearance === previousClearance) return;
            previousClearance = clearance;
            this.setKeyboardClearanceStyles(containerEl, clearance);
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
            this.addWindowKeyboardListener('orientationchange', scheduleUpdate);
        }
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

        for (const handle of this.keyboardPluginListenerHandles.splice(0)) {
            this.safeInvokeKeyboardPlugin(
                () => handle.remove?.(),
                'Could not remove native keyboard listener',
            );
        }

        this.keyboardVisualViewport = null;
        this.keyboardUpdateHandler = null;
        this.nativeKeyboardHeight = 0;
        this.setKeyboardClearanceStyles(this.containerEl, 0);
        this.clearKeyboardComposerOverlay(this.containerEl);
    }

    private getVisualViewport(): VisualViewport | null {
        if (typeof window === 'undefined') return null;
        return window.visualViewport ?? null;
    }

    private measureKeyboardClearance(containerEl: HTMLElement, inputEl: HTMLElement): {
        realClearance: number;
        composerHeight: number;
    } {
        if (!containerEl.getBoundingClientRect) {
            return {
                realClearance: 0,
                composerHeight: 0,
            };
        }

        const viewRect = containerEl.getBoundingClientRect();
        const viewportOverlap = this.calculateVisualViewportKeyboardOverlap(viewRect, this.getVisualViewport());
        const nativeOverlap = this.calculateKeyboardHeightOverlap(viewRect, this.nativeKeyboardHeight);
        const realClearance = Math.max(viewportOverlap, nativeOverlap);
        let composerHeight = 0;
        if (realClearance > 0) {
            const composerRect = inputEl.getBoundingClientRect?.();
            composerHeight = composerRect?.height && Number.isFinite(composerRect.height)
                ? Math.ceil(composerRect.height)
                : 0;
        }

        return {
            realClearance,
            composerHeight,
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

    private setKeyboardClearanceStyles(containerEl: HTMLElement, clearance: number) {
        // When JS has measured a real overlap (visualViewport or Capacitor keyboard event),
        // pin the explicit pixel value. When clearance is 0 we defer to CSS
        // env(keyboard-inset-height, 0px), which the browser/WebView fills in as soon as the
        // keyboard begins to show — bridging the 250-400 ms gap before our JS observers fire.
        // No more JS-side fallback estimation.
        if (clearance > 0) {
            containerEl.style?.setProperty('--pa-chat-keyboard-clearance', `${clearance}px`);
            containerEl.style?.setProperty('--pa-chat-keyboard-offset', `-${clearance}px`);
        } else {
            containerEl.style?.setProperty('--pa-chat-keyboard-clearance', 'env(keyboard-inset-height, 0px)');
            containerEl.style?.setProperty('--pa-chat-keyboard-offset', 'calc(0px - env(keyboard-inset-height, 0px))');
        }
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
            }
            scheduleUpdate();
        };
        const handleHide = () => {
            this.nativeKeyboardHeight = 0;
            scheduleUpdate();
        };

        this.addWindowKeyboardListener('keyboardWillShow', handleShow);
        this.addWindowKeyboardListener('keyboardDidShow', handleShow);
        this.addWindowKeyboardListener('keyboardWillHide', handleHide);
        this.addWindowKeyboardListener('keyboardDidHide', handleHide);

        const keyboardPlugin = this.getNativeKeyboardPlugin();
        if (!keyboardPlugin?.addListener) return;
        // Hand layout management off to Capacitor so the WebView itself resizes the layout
        // viewport above the keyboard. Combined with env(keyboard-inset-height) CSS, this
        // removes the need for JS-side height estimation entirely.
        this.safeInvokeKeyboardPlugin(
            () => keyboardPlugin.setResizeMode?.({ mode: 'body' }),
            'Could not set native keyboard resize mode',
        );
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

    // Wraps a Capacitor plugin call that may return void OR a Promise. The naive
    // `try { void op(); } catch {}` pattern silently drops async rejections — this helper
    // also attaches a .catch() so unhandled rejections do not leak.
    private safeInvokeKeyboardPlugin(op: () => unknown, errorMessage: string): void {
        try {
            const result = op();
            if (result && typeof (result as Promise<unknown>).catch === 'function') {
                (result as Promise<unknown>).catch((error) => {
                    this.plugin.log?.(errorMessage, error);
                });
            }
        } catch (error) {
            this.plugin.log?.(errorMessage, error);
        }
    }

    private shouldFocusComposerTextArea(
        target: EventTarget | null,
        composerRow: HTMLElement,
        textArea: HTMLTextAreaElement,
        allowTextAreaTarget: boolean,
    ): boolean {
        const targetElement = target as HTMLElement | null;
        if (!targetElement || typeof targetElement.tagName !== 'string') return false;

        let current: HTMLElement | null = targetElement;
        while (current) {
            if (current === textArea) return allowTextAreaTarget;
            if (current !== composerRow && this.isComposerInteractiveElement(current)) return false;
            if (current === composerRow) return true;
            current = current.parentElement;
        }

        return false;
    }

    private focusComposerTextArea(textArea: HTMLTextAreaElement) {
        try {
            textArea.focus({ preventScroll: true });
        } catch {
            textArea.focus();
        }
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

    private persistFinalizedTurn(
        prompt: string,
        entry: TimelineEntry,
    ): Promise<void> {
        const next = this.persistChain
            .catch(() => undefined)
            .then(() => this.runPersistFinalizedTurn(prompt, entry));
        this.persistChain = next;
        return next;
    }

    private async runPersistFinalizedTurn(
        prompt: string,
        entry: TimelineEntry,
    ): Promise<void> {
        if (entry.kind !== 'history') return;
        const manager = this.getChatHistoryManager();
        if (!manager) return;
        await manager.initialize();
        if (!manager.isAvailable()) return;
        try {
            let conversation = this.activeConversation;
            let conversationId = this.activeConversationId;
            if (!conversation || !conversationId) {
                const created = await manager.startConversation(prompt);
                conversation = created;
                conversationId = created.id;
                this.activeConversation = conversation;
                this.activeConversationId = conversationId;
                this.nextTurnIndex = 0;
            }
            const turnIndex = this.nextTurnIndex;
            const updated = await manager.recordTurn({
                conversationId,
                turnIndex,
                entry,
                userPrompt: prompt,
                conversation,
            });
            this.activeConversation = updated;
            this.nextTurnIndex = turnIndex + 1;
            this.persistedTurnIndexByEntry.set(entry, turnIndex);
            await manager.maybePrune();
        } catch (error) {
            this.plugin.log?.("Failed to persist chat turn", error);
        }
    }

    private async deletePersistedTurnForEntry(entry: TimelineEntry): Promise<void> {
        if (entry.kind !== 'history') return;
        const manager = this.getChatHistoryManager();
        if (!manager || !manager.isAvailable()) return;
        const conversationId = this.activeConversationId;
        if (!conversationId) return;
        const turnIndex = this.persistedTurnIndexByEntry.get(entry);
        if (turnIndex === undefined) return;
        try {
            await manager.deleteTurn(conversationId, turnIndex);
            this.persistedTurnIndexByEntry.delete(entry);
        } catch (error) {
            this.plugin.log?.("Failed to delete persisted chat turn", error);
        }
    }
}
