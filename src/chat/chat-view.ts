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
    getChatRoleIdenticonModel,
    type ChatRoleIdenticon,
    type ChatRoleIdenticonModel,
} from './role-identicons';
import { getPluginUiLanguage, makePluginTranslator, pluginT } from '../locales/plugin';
import {
    cancelPlatformAnimationFrame,
    clearPlatformTimeout,
    getPlatformCustomElements,
    getOptionalPlatformDocument,
    getOptionalPlatformWindow,
    getPlatformDocument,
    getPlatformPerformance,
    requestPlatformAnimationFrame,
    setPlatformTimeout,
    type PlatformAnimationFrameHandle,
    type PlatformTimeoutHandle,
} from '../platform-dom';
import { VIEW_TYPE_LLM } from './view-type';

export { VIEW_TYPE_LLM };
export const PA_CHAT_SUBAGENT_ICON = "PA_CHAT_SUBAGENT";
export type { ChatMessage };

const LIVE_MARKDOWN_SLOW_RENDER_MS = 12;
const LIVE_MARKDOWN_RENDER_COOLDOWN_MS = 32;
const KEYBOARD_LAYOUT_RESIZE_THRESHOLD_PX = 80;
const CHAT_DRAWER_HOST_CLASS = 'pa-chat-drawer-host';
const ROLE_IDENTICON_FILL_CLASSES: Record<string, string> = {
    'var(--pa-chat-role-identicon-yellow)': 'pa-chat-role-identicon-fill-yellow',
    'var(--pa-chat-role-identicon-orange)': 'pa-chat-role-identicon-fill-orange',
    'var(--pa-chat-role-identicon-red)': 'pa-chat-role-identicon-fill-red',
    'var(--pa-chat-role-identicon-purple)': 'pa-chat-role-identicon-fill-purple',
    'var(--pa-chat-role-identicon-blue)': 'pa-chat-role-identicon-fill-blue',
};

const getMonotonicTimeMs = () => {
    const performanceApi = getPlatformPerformance();
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

function createMessageActionButton(
    parent: HTMLElement,
    { cls, icon, label }: { cls: string; icon: string; label: string },
): HTMLButtonElement {
    const button = parent.createEl('button', {
        cls: `message-action-button ${cls}`,
        attr: {
            type: 'button',
            'aria-label': label,
            title: label,
        },
    });
    setIcon(button, icon);
    return button;
}

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
type KeyboardClearanceSource = 'native' | 'none' | 'visualViewport';

interface KeyboardPluginInfo {
    keyboardHeight?: number;
}

interface KeyboardPluginListenerHandle {
    remove?: () => Promise<void> | void;
}

// Capacitor Keyboard plugin facade. We let the WebView/layout viewport handle mobile keyboard
// geometry where possible, and only use native height as a fallback measurement.
interface KeyboardPluginFacade {
    addListener?: (
        eventName: KeyboardPluginEventName,
        listenerFunc: (info: KeyboardPluginInfo) => void,
    ) => Promise<KeyboardPluginListenerHandle> | KeyboardPluginListenerHandle;
    setResizeMode?: (options: { mode: string }) => Promise<void> | void;
}

function ensureChatLoadersRegistered(log?: (message: string, error?: unknown) => void): void {
    if (ldrsLoadersRequested) return;
    if (!getPlatformCustomElements()) return;

    ldrsLoadersRequested = true;
    void Promise.all([
        import('ldrs/quantum'),
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
    private scheduledScrollFrame: PlatformAnimationFrameHandle | null = null;
    private panelResizeObserver: ResizeObserver | null = null;
    private statusBarResizeObserver: ResizeObserver | null = null;
    private statusBarResizeHandler: (() => void) | null = null;
    private statusBarResizeWindow: Window | null = null;
    private keyboardVisualViewport: VisualViewport | null = null;
    private keyboardUpdateHandler: (() => void) | null = null;
    private keyboardUpdateFrame: PlatformAnimationFrameHandle | null = null;
    private keyboardWindowListeners: Array<{ type: KeyboardWindowEventName; listener: EventListener; target: Window }> = [];
    private keyboardPluginListenerHandles: KeyboardPluginListenerHandle[] = [];
    private keyboardLayoutBaselineHeight = 0;
    private nativeKeyboardHeight = 0;
    private nativeKeyboardVisible = false;
    private memoryStatusUnsubscribe: (() => void) | null = null;
    private settingsChangeUnsubscribe: (() => void) | null = null;
    private markdownRenderOwners = new Set<Component>();
    private mobileTabBarHandle: HTMLElement | null = null;
    private mobileTabBarOptions: HTMLElement | null = null;
    private mobileTabBarOptionsHandler: (() => void) | null = null;
    private mobileTabBarDismissTimer: PlatformTimeoutHandle | null = null;
    private chatDrawerHost: HTMLElement | null = null;
    private activeConversationId: string | null = null;
    private activeConversation: PersistedConversation | null = null;
    private nextTurnIndex = 0;
    private persistedTurnIndexByEntry = new WeakMap<TimelineEntry, number>();
    private persistChain: Promise<void> = Promise.resolve();
    private composerTextArea: HTMLTextAreaElement | null = null;
    private syncComposerControlsForExternalPrefill: (() => void) | null = null;
    private viewTeardownCallbacks = new Set<() => void>();

    get isStreaming(): boolean {
        return this.abortController !== null;
    }

    prefillComposer(prompt: string): boolean {
        if (!this.composerTextArea || !this.syncComposerControlsForExternalPrefill) return false;
        if (this.composerTextArea.value.trim().length > 0 && this.composerTextArea.value !== prompt) {
            this.composerTextArea.focus();
            return false;
        }
        this.composerTextArea.value = prompt;
        this.syncComposerControlsForExternalPrefill();
        this.composerTextArea.focus();
        return true;
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

    private registerViewTeardown(callback: () => void): void {
        this.viewTeardownCallbacks.add(callback);
    }

    private runViewTeardownCallbacks(): void {
        const callbacks = Array.from(this.viewTeardownCallbacks);
        this.viewTeardownCallbacks.clear();
        for (const callback of callbacks) {
            try {
                callback();
            } catch (error) {
                this.plugin.log?.("Could not tear down chat view resource", error);
            }
        }
    }

    getViewType(): string {
        return VIEW_TYPE_LLM;
    }

    getDisplayText(): string {
        return pluginT("plugin.chat.displayText", getPluginUiLanguage());
    }

    getIcon(): string {
        return PA_CHAT_SUBAGENT_ICON;
    }

    async onOpen() {
        const sessionId = this.startViewSession();
        const t = makePluginTranslator(getPluginUiLanguage());
        ensureChatLoadersRegistered((message, error) => this.plugin.log(message, error));
        const { containerEl } = this;
        containerEl.empty();
        containerEl.classList.add('llm-view');
        this.markChatDrawerHost(containerEl);
        this.observePanelDensity(containerEl);
        this.observeStatusBarClearance(containerEl);

        const chatContainer = containerEl.createDiv({ cls: 'llm-chat-container' });

        const inputDiv = containerEl.createDiv({ cls: 'llm-input' });
        this.setupMobileTabBarAutoHide(containerEl);
        containerEl.createDiv({
            cls: 'pa-chat-keyboard-spacer',
            attr: { 'aria-hidden': 'true' },
        });
        const composerRow = inputDiv.createDiv({ cls: 'pa-chat-composer-row' });
        const textArea = composerRow.createEl('textarea', {
            attr: { rows: '3', placeholder: t("plugin.chat.placeholder.askAboutNotes") }
        });
        const skillTypeahead = inputDiv.createDiv({
            cls: 'pa-chat-skill-typeahead',
            attr: {
                role: 'listbox',
                'aria-label': t("plugin.chat.skillGuides"),
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
                showComposerHint(t("plugin.chat.hint.waitForAnswer"));
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
            text: t("plugin.chat.action.ask"),
            cls: 'pa-chat-icon-button send-button-visible',
            attr: {
                type: 'button',
                'aria-label': t("plugin.chat.action.ask"),
                title: t("plugin.chat.action.ask"),
            },
        });
        setIcon(sendButton, 'send');
        sendButton.createSpan({ cls: 'pa-sr-only', text: t("plugin.chat.action.ask") });
        const memoryControl = buttonDiv.createSpan({ cls: 'pa-chat-memory-control' });
        const memoryChip = memoryControl.createEl('button', {
            cls: 'pa-chat-icon-button pa-chat-memory-chip personal-assistant-ai-statusbar',
            attr: {
                type: 'button',
                'aria-label': t("plugin.chat.memory.showStatus"),
                title: t("plugin.chat.memory.showStatus"),
            },
        });
        setIcon(memoryChip, 'brain');
        const memoryChipLabel = memoryChip.createSpan({ cls: 'pa-sr-only', text: t("plugin.chat.memory") });
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
                'aria-label': t("plugin.chat.action.stopGeneration"),
                title: t("plugin.chat.action.stopGeneration"),
            },
        });
        setIcon(cancelButton, 'square');
        cancelButton.createSpan({ cls: 'pa-sr-only', text: t("plugin.chat.action.stopGeneration") });
        cancelButton.classList.add('cancel-button-hidden');
        const moreControl = buttonDiv.createSpan({ cls: 'pa-chat-more-control' });
        const moreButton = moreControl.createEl('button', {
            cls: 'pa-chat-icon-button pa-chat-more-button',
            attr: {
                type: 'button',
                'aria-label': t("plugin.chat.action.moreChatActions"),
                title: t("plugin.chat.action.moreChatActions"),
                'aria-expanded': 'false',
            },
        });
        setIcon(moreButton, 'ellipsis');
        moreButton.createSpan({ cls: 'pa-sr-only', text: t("plugin.chat.action.moreChatActions") });
        const composerMenu = moreControl.createDiv({ cls: 'pa-chat-menu pa-chat-composer-menu' });
        composerMenu.hidden = true;
        const newChatButton = createChatMenuItem(composerMenu, {
            text: t("plugin.chat.action.newChat"),
            icon: 'plus-square',
        });
        const historyButton = createChatMenuItem(composerMenu, {
            text: t("plugin.chat.action.history"),
            icon: 'history',
        });
        const copyConversationButton = createChatMenuItem(composerMenu, {
            text: t("plugin.chat.action.copyConversation"),
            icon: 'copy',
        });
        createChatMenuDivider(composerMenu);
        const technicalMemoryButton = createChatMenuItem(composerMenu, {
            text: t("plugin.chat.action.showMemoryStatus"),
            icon: 'activity',
        });
        const settingsButton = createChatMenuItem(composerMenu, {
            text: t("plugin.chat.action.openSettings"),
            icon: 'settings',
        });
        createChatMenuDivider(composerMenu);
        const clearButton = createChatMenuItem(composerMenu, {
            text: t("plugin.chat.action.clearChat"),
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
                cancelPlatformAnimationFrame(this.scheduledScrollFrame);
            }

            let frameId: PlatformAnimationFrameHandle | null = null;
            frameId = requestPlatformAnimationFrame(() => {
                if (frameId === null) return;
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
            let idleTimer: PlatformTimeoutHandle | null = null;
            const clear = () => {
                if (idleTimer === null) return;
                clearPlatformTimeout(idleTimer);
                idleTimer = null;
            };
            const schedule = () => {
                clear();
                if (menu.hidden) return;
                idleTimer = setPlatformTimeout(() => {
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
            this.registerViewTeardown(() => {
                clear();
                for (const element of [menu, toggleButton]) {
                    for (const eventName of idleEvents) {
                        element.removeEventListener(eventName, refresh);
                    }
                }
            });
            return { clear, close, schedule };
        };
        const syncComposerControls = () => {
            const generating = isGenerating();
            const hasDraft = textArea.value.trim().length > 0;
            const setupIssue = this.plugin.getAISetupIssue?.() ?? null;
            sendButton.disabled = generating || !hasDraft || setupIssue !== null;
            if (generating && !isStopping && !isFinalizing) {
                textArea.setAttribute('placeholder', t("plugin.chat.placeholder.draftNextMessage"));
                sendButton.classList.replace('send-button-visible', 'send-button-hidden');
                cancelButton.classList.replace('cancel-button-hidden', 'cancel-button-visible');
            } else {
                textArea.setAttribute(
                    'placeholder',
                    generating
                        ? t("plugin.chat.placeholder.draftNextMessage")
                        : setupIssue
                            ? t("plugin.chat.placeholder.setupProviderFirst")
                            : t("plugin.chat.placeholder.askAboutNotes"),
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
            kind: 'thinking',
        ): HTMLElement => {
            const wrapper = parent.createSpan({
                cls: `pa-chat-role-loader pa-chat-role-loader-${kind}`,
                attr: { 'aria-hidden': 'true' },
            });
            wrapper.createEl('l-quantum' as keyof HTMLElementTagNameMap, {
                cls: 'pa-chat-role-loader-element',
                attr: {
                    size: '16',
                    speed: '1.75',
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
            const doc = getOptionalPlatformDocument();
            if (typeof doc?.createElementNS === 'function') {
                return doc.createElementNS('http://www.w3.org/2000/svg', tagName);
            }
            const fallbackParent = parent as Element & { createEl?: (tagName: string) => HTMLElement };
            if (typeof fallbackParent.createEl === 'function') {
                return fallbackParent.createEl(tagName) as unknown as Element;
            }
            if (!doc) {
                throw new Error("Document is unavailable.");
            }
            return doc.createElement(tagName);
        };
        const createRoleIdenticon = (
            parent: HTMLElement,
            role: ChatRoleIdenticon,
            model: ChatRoleIdenticonModel,
            active: boolean,
        ) => {
            const identiconEl = parent.createSpan({
                cls: [
                    'pa-chat-role-identicon',
                    `pa-chat-role-identicon-${role}`,
                    ROLE_IDENTICON_FILL_CLASSES[model.fill] ?? 'pa-chat-role-identicon-fill-blue',
                    active ? 'pa-chat-role-identicon-active' : '',
                ].filter(Boolean).join(' '),
                attr: { 'aria-hidden': 'true' },
            });
            identiconEl.setCssProps({ '--pa-chat-role-identicon-fill': model.fill });

            const svgEl = createSvgChild(identiconEl, 'svg');
            svgEl.classList.add('pa-chat-role-identicon-svg');
            svgEl.setAttribute('class', 'pa-chat-role-identicon-svg');
            svgEl.setAttribute('viewBox', model.viewBox);
            svgEl.setAttribute('fill', 'none');
            svgEl.setAttribute('focusable', 'false');
            svgEl.setAttribute('shape-rendering', 'crispEdges');
            identiconEl.appendChild(svgEl);

            for (const cell of model.cells) {
                const rectEl = createSvgChild(svgEl, 'rect');
                const className = active
                    ? `pa-chat-role-identicon-cell pa-chat-role-identicon-filled-cell pa-chat-role-identicon-filled-scan pa-chat-role-identicon-scan-row-${cell.row}`
                    : 'pa-chat-role-identicon-cell pa-chat-role-identicon-filled-cell';
                rectEl.classList.add(...className.split(' '));
                rectEl.setAttribute('class', className);
                rectEl.setAttribute('x', String(cell.col * model.cellSize));
                rectEl.setAttribute('y', String(cell.row * model.cellSize));
                rectEl.setAttribute('width', String(model.cellSize));
                rectEl.setAttribute('height', String(model.cellSize));
                rectEl.setAttribute('fill', 'var(--pa-chat-role-identicon-fill)');
                svgEl.appendChild(rectEl);
            }

            if (!active) return;

            for (const cell of model.emptyCells) {
                const rectEl = createSvgChild(svgEl, 'rect');
                const className = `pa-chat-role-identicon-cell pa-chat-role-identicon-empty-scan pa-chat-role-identicon-scan-row-${cell.row}`;
                rectEl.classList.add(...className.split(' '));
                rectEl.setAttribute('class', className);
                rectEl.setAttribute('x', String(cell.col * model.cellSize));
                rectEl.setAttribute('y', String(cell.row * model.cellSize));
                rectEl.setAttribute('width', String(model.cellSize));
                rectEl.setAttribute('height', String(model.cellSize));
                rectEl.setAttribute('fill', 'var(--pa-chat-role-identicon-fill)');
                svgEl.appendChild(rectEl);
            }
        };
        const stopRoleIdenticonScan = (roleEl?: HTMLElement | null) => {
            const identiconEl = roleEl?.querySelector('.pa-chat-role-identicon-active');
            if (!identiconEl) return;

            identiconEl.classList.remove('pa-chat-role-identicon-active');
            identiconEl
                .querySelectorAll('.pa-chat-role-identicon-empty-scan')
                .forEach((cell) => cell.parentElement?.removeChild(cell));
            identiconEl
                .querySelectorAll('.pa-chat-role-identicon-filled-scan')
                .forEach((cell) => {
                    cell.classList.remove('pa-chat-role-identicon-filled-scan');
                    cell.setAttribute('class', 'pa-chat-role-identicon-cell pa-chat-role-identicon-filled-cell');
                });
        };
        const createRoleLabel = (
            parent: HTMLElement,
            text: string,
            options: {
                extraClass?: string;
                identicon?: ChatRoleIdenticon;
                loader?: 'thinking';
                activeIdenticon?: boolean;
            } = {},
        ): { roleEl: HTMLElement; loaderEl?: HTMLElement } => {
            const roleEl = parent.createDiv({
                cls: ['message-role', options.extraClass ?? ''].filter(Boolean).join(' '),
            });
            if (options.identicon) {
                createRoleIdenticon(
                    roleEl,
                    options.identicon,
                    getChatRoleIdenticonModel(options.identicon),
                    Boolean(options.activeIdenticon && options.identicon === 'assistant'),
                );
            }
            const loaderEl = options.loader ? createRoleLoader(roleEl, options.loader) : undefined;
            roleEl.createSpan({ cls: 'pa-chat-role-text', text });
            return {
                roleEl,
                loaderEl,
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
        this.composerTextArea = textArea;
        this.syncComposerControlsForExternalPrefill = () => {
            hideComposerHint();
            renderSkillTypeahead();
            syncComposerControls();
        };
        const getMemoryChipState = (plan?: MemoryMaintenancePlan | null): MemoryChipState => {
            if (this.plugin.settings?.memoryEnabled === false) {
                return { label: t("plugin.chat.memory.unavailable"), visualState: 'unavailable' };
            }
            if (!plan) {
                return { label: t("plugin.chat.memory"), visualState: 'unavailable' };
            }
            if (plan.reason === 'ready') {
                return { label: t("plugin.chat.memory.ready"), visualState: 'ready' };
            }
            if (plan.reason === 'changed-notes') {
                return {
                    label: t("plugin.chat.memory.needsUpdate"),
                    visualState: 'needs-update',
                    actionLabel: t("plugin.chat.memory.update"),
                    actionKind: 'update',
                };
            }
            if (plan.reason === 'settings-changed') {
                return {
                    label: t("plugin.chat.memory.needsUpdate"),
                    visualState: 'needs-update',
                    actionLabel: t("plugin.chat.memory.prepare"),
                    actionKind: 'prepare',
                };
            }
            if (plan.reason === 'first-use' || plan.reason === 'local-memory-missing') {
                return {
                    label: t("plugin.chat.memory.needsSetup"),
                    visualState: 'needs-setup',
                    actionLabel: t("plugin.chat.memory.prepare"),
                    actionKind: 'prepare',
                };
            }
            return { label: t("plugin.chat.memory.unavailable"), visualState: 'unavailable' };
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
                text: t("plugin.chat.action.openSettings"),
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
                text: t("plugin.chat.action.showMemoryStatus"),
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

            const setupIssue = this.plugin.getAISetupIssue?.() ?? null;
            if (setupIssue) {
                emptyStateEl = this.responseDiv.createDiv({ cls: 'pa-chat-empty-state pa-chat-config-banner' });
                emptyStateEl.createDiv({ cls: 'pa-chat-empty-title', text: t("plugin.chat.empty.setupTitle") });
                emptyStateEl.createDiv({ cls: 'pa-chat-empty-hint', text: setupIssue });
                const actions = emptyStateEl.createDiv({ cls: 'pa-chat-empty-chips' });
                const settingsButton = actions.createEl('button', {
                    text: t("plugin.chat.action.openSettingsTitle"),
                    cls: 'pa-chat-empty-chip mod-cta',
                    attr: { type: 'button' },
                });
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
                return;
            }

            const hasNote = isMarkdownNoteAvailable();
            emptyStateEl = this.responseDiv.createDiv({ cls: 'pa-chat-empty-state' });
            emptyStateEl.createDiv({ cls: 'pa-chat-empty-title', text: t("plugin.chat.empty.askTitle") });
            const chips = emptyStateEl.createDiv({ cls: 'pa-chat-empty-chips' });
            const chipSpecs = [
                { label: t("plugin.chat.empty.summarizeCurrentNote"), prompt: t("plugin.chat.prompt.summarizeCurrentNote") },
                { label: t("plugin.chat.empty.findRelatedNotes"), prompt: t("plugin.chat.prompt.findRelatedNotes") },
                { label: t("plugin.chat.empty.draftFromCurrentNote"), prompt: t("plugin.chat.prompt.draftFromCurrentNote") },
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
                        showComposerHint(t("plugin.chat.hint.openNoteToUse"));
                        return;
                    }
                    fillComposer(spec.prompt);
                };
            });
            if (!hasNote) {
                emptyStateEl.createDiv({ cls: 'pa-chat-empty-hint', text: t("plugin.chat.hint.openNoteToUse") });
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
            return getOptionalPlatformDocument()?.createElement('div')
                ?? this.responseDiv.createDiv({ cls: 'message-render-buffer-detached-fallback' }) as HTMLElement;
        };
        const renderMarkdownInto = (
            rendered: RenderedMessage,
            content: string,
            isLive: () => boolean,
            options: MarkdownRenderOptions = {},
        ): Promise<boolean> => {
            rendered.renderToken += 1;
            rendered.copyContent = content;
            syncMessageCopyButton(rendered);
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
            scheduledDrainTimer?: PlatformTimeoutHandle;
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
            clearPlatformTimeout(state.scheduledDrainTimer);
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
            state.scheduledDrainTimer = setPlatformTimeout(() => {
                state.scheduledDrainTimer = undefined;
                runLiveMarkdownRender(rendered, state, isLive, options);
            }, delayMs);
            (state.scheduledDrainTimer as unknown as { unref?: () => void }).unref?.();
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
            syncMessageCopyButton(rendered);
            const state = getLiveMarkdownRenderState(rendered);
            state.pendingContent = content;
            state.pendingForceScroll = Boolean(state.pendingForceScroll || options.forceScroll);
            runLiveMarkdownRender(rendered, state, isLive, options);
        };
        const cancelLiveMarkdownRender = (rendered?: RenderedMessage | null) => {
            if (!rendered) return;
            rendered.renderToken += 1;
            const state = liveMarkdownRenderStates.get(rendered);
            if (state) {
                clearScheduledLiveMarkdownDrain(state);
                state.pendingContent = undefined;
                state.pendingForceScroll = false;
                state.inFlightContent = undefined;
                state.inFlightPromise = undefined;
                state.inFlight = false;
            }
            this.unloadMarkdownRenderOwner(rendered.renderOwner);
            rendered.renderOwner = undefined;
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
                const addMessageButton = createMessageActionButton(rendered.actionDiv, {
                    icon: 'file-plus',
                    cls: 'add-to-editor-message-button',
                    label: t("plugin.chat.action.addToEditor"),
                });
                rendered.actionDiv.insertBefore(addMessageButton, rendered.actionMenuButton);
                addMessageButton.onclick = () => {
                    void options.onAddToEditor?.(rendered.copyContent);
                };
                rendered.addMessageButton = addMessageButton;
            }

            if (options.onDelete && !rendered.deleteButton) {
                const deleteButton = createChatMenuItem(rendered.actionMenu, {
                    text: t("plugin.chat.action.delete"),
                    icon: 'trash-2',
                    cls: 'pa-chat-menu-item-danger delete-message-button',
                });
                rendered.deleteButton = deleteButton;
                rendered.actionMenuButton.hidden = false;
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

        const syncMessageCopyButton = (rendered: RenderedMessage) => {
            if (!rendered.copyButton) return;
            rendered.copyButton.disabled = rendered.copyContent.length === 0;
        };

        const positionMessageActionMenu = (actionDiv: HTMLElement, actionMenu: HTMLElement) => {
            actionMenu.classList.remove('pa-chat-message-menu-below');
            const container = actionDiv.closest('.llm-chat-container') ?? this.responseDiv;
            const actionRect = actionDiv.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const menuRect = actionMenu.getBoundingClientRect();
            const menuGap = 8;
            const roomAbove = actionRect.top - containerRect.top;
            const roomBelow = containerRect.bottom - actionRect.bottom;
            if (roomAbove < menuRect.height + menuGap && roomBelow > roomAbove) {
                actionMenu.classList.add('pa-chat-message-menu-below');
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
            const { roleEl, loaderEl } = createRoleLabel(messageDiv, message.role === 'user' ? t("plugin.chat.role.you") : t("plugin.chat.role.assistant"), {
                identicon: message.role,
                activeIdenticon: options.showAssistantLoader,
            });
            const contentDiv = messageDiv.createDiv({ cls: 'message-content' }) as HTMLElement;
            const actionDiv = messageDiv.createDiv({
                cls: 'message-actions message-action-toolbar',
                attr: {
                    role: 'group',
                    'aria-label': t("plugin.chat.message.actions"),
                },
            });
            const copyButton = createMessageActionButton(actionDiv, {
                cls: 'copy-message-button',
                icon: 'copy',
                label: t("plugin.chat.action.copyMessage"),
            });
            const menuButton = createMessageActionButton(actionDiv, {
                cls: 'message-more-button',
                icon: 'ellipsis',
                label: t("plugin.chat.action.moreMessageActions"),
            });
            menuButton.setAttribute('aria-expanded', 'false');
            menuButton.hidden = true;
            const actionMenu = actionDiv.createDiv({ cls: 'pa-chat-menu pa-chat-message-menu' });
            const rendered: RenderedMessage = {
                messageDiv,
                roleEl,
                loaderEl,
                contentDiv,
                actionDiv,
                actionMenu,
                actionMenuButton: menuButton,
                copyButton,
                renderToken: 0,
                copyContent: message.content,
                memoryMetadata: options.memoryMetadata ?? message.memoryMetadata,
                canonicalTurn: message.canonicalTurn,
            };
            syncMessageCopyButton(rendered);
            rendered.actionMenu.hidden = true;
            const actionMenuAutoClose = createIdleMenuAutoClose(rendered.actionMenu, menuButton, () => {
                rendered.actionMenu.hidden = true;
                menuButton.setAttribute('aria-expanded', 'false');
            });
            menuButton.onclick = () => {
                if (rendered.actionMenu.hidden) {
                    rendered.actionMenu.hidden = false;
                    positionMessageActionMenu(actionDiv, rendered.actionMenu);
                    menuButton.setAttribute('aria-expanded', 'true');
                    actionMenuAutoClose.schedule();
                } else {
                    actionMenuAutoClose.close();
                }
            };
            copyButton.onclick = () => {
                if (copyButton.disabled) return;
                navigator.clipboard.writeText(rendered.copyContent).then(() => {
                    new Notice(t("plugin.chat.notice.copied"));
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
                title: t("plugin.chat.confirm.deleteMessage.title"),
                message: t("plugin.chat.confirm.deleteMessage.fullTurn"),
                confirmText: t("plugin.chat.action.delete"),
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
            new Notice(t("plugin.chat.notice.messageDeleted"));
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
            createRoleLabel(row, entry.terminalKind === 'error' ? t("plugin.chat.role.error") : t("plugin.chat.role.cancelled"));
            row.createDiv({ cls: 'message-content', text: entry.content });
            const actions = row.createDiv({ cls: 'message-actions turn-terminal-actions' });
            const retryButton = actions.createEl('button', {
                cls: 'message-action-button retry-message-button',
                attr: {
                    'aria-label': t("plugin.chat.action.retryMessage"),
                    title: t("plugin.chat.action.retryMessage"),
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
                attr: { 'aria-label': t("plugin.chat.action.deleteMessage") },
            });
            setIcon(deleteButton, 'trash');
            deleteButton.onclick = () => {
                if (deleteButton.disabled || isGenerating()) return;
                void confirmChatAction(this.plugin, {
                    title: t("plugin.chat.confirm.deleteMessage.title"),
                    message: t("plugin.chat.confirm.deleteMessage.unfinishedTurn"),
                    confirmText: t("plugin.chat.action.delete"),
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
                        'aria-label': t("plugin.chat.action.copyError"),
                        title: t("plugin.chat.action.copyError"),
                    },
                });
                setIcon(copyErrorButton, 'copy');
                copyErrorButton.onclick = () => {
                    navigator.clipboard.writeText(entry.errorDetail ?? entry.content).then(() => {
                        new Notice(t("plugin.chat.notice.copied"));
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
            cancelLiveMarkdownRender(turn.assistantMessage);
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
                    'aria-label': t("plugin.chat.thinking.showDetails"),
                    'aria-expanded': 'false',
                    'aria-controls': detailsId,
                },
            });
            setIcon(toggleButton, 'chevron-right');
            const { loaderEl } = createRoleLabel(headerDiv, t("plugin.chat.role.thinking"), {
                extraClass: 'thinking-status-role',
                loader: 'thinking',
            });
            const summaryEl = headerDiv.createDiv({ cls: 'thinking-status-summary' });
            summaryEl.setAttribute('aria-live', 'polite');
            const detailsEl = messageDiv.createDiv({ cls: 'thinking-status-details' });
            detailsEl.id = detailsId;
            detailsEl.hidden = true;
            const activitySectionEl = detailsEl.createDiv({ cls: 'thinking-status-section thinking-status-activity' });
            activitySectionEl.createDiv({ cls: 'thinking-status-section-title', text: t("plugin.chat.thinking.assistantActivity") });
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
                    statusView.expanded ? t("plugin.chat.thinking.hideDetails") : t("plugin.chat.thinking.showDetails")
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
            section.createDiv({ cls: 'thinking-status-section-title', text: t("plugin.chat.thinking.providerThinking") });
            const contentEl = section.createDiv({ cls: 'thinking-status-reasoning-content' });
            statusView.reasoningSectionEl = section;
            statusView.reasoningContentEl = contentEl;
            return contentEl;
        };

        const renderProviderReasoningNotice = (statusView: ThinkingStatusView) => {
            const contentEl = ensureProviderReasoningNotice(statusView);
            contentEl.setText(t("plugin.chat.thinking.providerReasoningHidden"));
        };

        const appendProviderReasoning = (turn: UiTurn, delta: string) => {
            if (!delta) return;
            turn.providerReasoningObserved = true;
            turn.statusView ??= createThinkingStatusView(turn);
            turn.statusView.summaryEl.setText(t("plugin.chat.thinking.qwenThinking"));
            renderProviderReasoningNotice(turn.statusView);
            scrollToBottom();
        };

        const ensureWarningList = (statusView: ThinkingStatusView) => {
            if (statusView.warningListEl) return statusView.warningListEl;
            const section = statusView.detailsEl.createDiv({ cls: 'thinking-status-section thinking-status-warnings' });
            section.createDiv({ cls: 'thinking-status-section-title', text: t("plugin.chat.thinking.warnings") });
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

        const completeThinkingStatus = (statusView: ThinkingStatusView, summary = t("plugin.chat.thinking.complete")) => {
            stopThinkingLoader(statusView);
            statusView.summaryEl.setText(summary);
        };

        const ensureContextUsedList = (statusView: ThinkingStatusView) => {
            if (statusView.contextUsedListEl) return statusView.contextUsedListEl;
            const section = statusView.detailsEl.createDiv({ cls: 'thinking-status-section thinking-status-context-used' });
            section.createDiv({ cls: 'thinking-status-section-title', text: t("plugin.chat.thinking.contextUsed") });
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
                    row.createDiv({ cls: 'thinking-status-context-note', text: t("plugin.chat.thinking.memoryEligible") });
                } else if (item.statusOnly) {
                    row.createDiv({ cls: 'thinking-status-context-note', text: t("plugin.chat.thinking.statusOnly") });
                } else {
                    row.createDiv({ cls: 'thinking-status-context-note', text: t("plugin.chat.thinking.notMemoryReference") });
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
            stopRoleIdenticonScan(assistantRendered.roleEl);
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
                                const content = t("plugin.chat.terminal.answerStoppedEarly");
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
                    createTerminalEntry(turn, t("plugin.chat.notice.generationCancelled"), 'cancelled');
                    this.result = previousResult;
                } else {
                    createTerminalEntry(turn, t("plugin.chat.terminal.answerDidNotFinish"), 'error', String(error));
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
                new Notice(t("plugin.chat.notice.generationCancelled"));
            }
        };

        sendButton.onclick = () => {
            void sendPrompt(textArea.value);
        };

        clearButton.onclick = async () => {
            const confirmed = await confirmChatAction(this.plugin, {
                title: t("plugin.chat.confirm.clearChat.title"),
                message: t("plugin.chat.confirm.clearChat.message"),
                confirmText: t("plugin.chat.confirm.clearChat.action"),
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
            new Notice(t("plugin.chat.notice.currentChatCleared"));
        };

        const addContentToEditor = async (content: string) => {
            let targetLeaf = this.app.workspace.getMostRecentLeaf();
            if (!targetLeaf || !(targetLeaf.view instanceof MarkdownView)) {
                const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
                if (markdownLeaves.length > 0) {
                    targetLeaf = markdownLeaves[0];
                } else {
                    new Notice(t("plugin.chat.notice.openMarkdownFirst"));
                    return;
                }
            }

            if (targetLeaf && targetLeaf.view instanceof MarkdownView && content) {
                await this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
                const editor = targetLeaf.view.editor;
                const cursor = editor.getCursor();
                editor.replaceRange(content, cursor);
                new Notice(t("plugin.chat.notice.addedResponseToEditor"));
            }
        };

        copyConversationButton.onclick = () => {
            const conversationText = timelineEntries.map((entry) => {
                if (entry.kind === 'history') {
                    return `${t("plugin.chat.role.you")}:\n${entry.user.content}\n\n${t("plugin.chat.role.assistant")}:\n${entry.assistant.content}`;
                }
                const label = entry.terminalKind === 'error' ? t("plugin.chat.role.error") : t("plugin.chat.role.cancelled");
                return `${t("plugin.chat.role.you")}:\n${entry.prompt}\n\n${label}:\n${entry.content}`;
            }).join('\n\n');
            navigator.clipboard.writeText(conversationText).then(() => {
                new Notice(t("plugin.chat.notice.conversationCopied"));
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
                if (showNotice) new Notice(t("plugin.chat.notice.historyUnavailable"));
                return null;
            }
            await manager.initialize();
            if (!manager.isAvailable()) {
                if (showNotice) new Notice(t("plugin.chat.notice.historyUnavailable"));
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
                new Notice(t("plugin.chat.notice.waitForSwitch"));
                return;
            }
            await this.persistChain.catch(() => undefined);
            const manager = await getReadyHistoryManager(true);
            if (!manager) return;
            try {
                const conversation = await manager.findConversation(conversationId);
                if (!conversation) {
                    new Notice(t("plugin.chat.notice.conversationMissing"));
                    return;
                }
                if (!isCurrentSession()) return;
                if (isGenerating()) {
                    new Notice(t("plugin.chat.notice.waitForSwitch"));
                    return;
                }
                await manager.setActiveConversationId(conversationId);
                const turns = await manager.getTurns(conversationId);
                if (!isCurrentSession()) return;
                applyRestoredConversation(conversation, turns);
            } catch (error) {
                this.plugin.log?.("Failed to switch chat conversation", error);
                new Notice(t("plugin.chat.notice.loadConversationFailed"));
            }
        };

        const startNewConversation = async () => {
            if (isGenerating()) {
                new Notice(t("plugin.chat.notice.waitForNewChat"));
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
            new Notice(t("plugin.chat.notice.startedNewChat"));
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
                        title: t("plugin.chat.confirm.deleteConversation.title"),
                        message: t("plugin.chat.confirm.deleteConversation.message"),
                        confirmText: t("plugin.chat.action.delete"),
                        danger: true,
                    });
                    if (!confirmed) return;
                    if (!isCurrentSession()) return;
                    await manager.deleteConversation(selection.conversationId);
                    if (!isCurrentSession()) return;
                    if (selection.conversationId === this.activeConversationId) {
                        await startNewConversation();
                    } else {
                        new Notice(t("plugin.chat.notice.conversationDeleted"));
                    }
                }
            } catch (error) {
                this.plugin.log?.("Failed to open chat history picker", error);
                new Notice(t("plugin.chat.notice.openHistoryFailed"));
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
        this.settingsChangeUnsubscribe = this.plugin.onSettingsChanged?.(() => {
            if (!isCurrentSession()) return;
            syncComposerControls();
            renderEmptyState();
        }) ?? null;
        void refreshMemoryChipState();

        // vss cache updates are now handled globally in the plugin
    }

    async onClose() {
        this.viewSessionId += 1;
        this.invalidateActiveTurn();
        this.runViewTeardownCallbacks();
        this.cancelScheduledScroll();
        this.unloadAllMarkdownRenderOwners();
        this.panelResizeObserver?.disconnect();
        this.panelResizeObserver = null;
        this.disconnectStatusBarClearance();
        this.disconnectKeyboardClearance();
        this.disconnectMemoryStatusListener();
        this.disconnectSettingsChangeListener();
        this.teardownMobileTabBarAutoHide();
        this.clearChatDrawerHost();
        this.composerTextArea = null;
        this.syncComposerControlsForExternalPrefill = null;
    }

    private startViewSession(): number {
        this.runViewTeardownCallbacks();
        this.cancelScheduledScroll();
        this.disconnectKeyboardClearance();
        this.disconnectMemoryStatusListener();
        this.disconnectSettingsChangeListener();
        this.viewSessionId += 1;
        return this.viewSessionId;
    }

    private disconnectMemoryStatusListener() {
        this.memoryStatusUnsubscribe?.();
        this.memoryStatusUnsubscribe = null;
    }

    private disconnectSettingsChangeListener() {
        this.settingsChangeUnsubscribe?.();
        this.settingsChangeUnsubscribe = null;
    }

    private setupMobileTabBarAutoHide(containerEl: HTMLElement) {
        this.teardownMobileTabBarAutoHide();
        if (!Platform.isMobile) return;
        const t = makePluginTranslator(getPluginUiLanguage());
        const tabContainer = containerEl.closest('.workspace-drawer-tab-container');
        if (!tabContainer) return;
        const tabOptions = tabContainer.querySelector<HTMLElement>('.workspace-drawer-tab-options');
        if (!tabOptions) return;
        this.mobileTabBarOptions = tabOptions;

        const handle = getPlatformDocument().createElement('div');
        handle.className = 'pa-tab-bar-handle';
        handle.setAttribute('aria-label', t("plugin.chat.mobile.showTabBar"));
        handle.setAttribute('aria-expanded', 'false');
        setIcon(handle, 'chevron-up');
        containerEl.appendChild(handle);
        this.mobileTabBarHandle = handle;

        const dismiss = () => {
            tabOptions.classList.remove('pa-tab-bar-visible');
            setIcon(handle, 'chevron-up');
            handle.setAttribute('aria-label', t("plugin.chat.mobile.showTabBar"));
            handle.setAttribute('aria-expanded', 'false');
        };
        const scheduleDismiss = () => {
            this.clearMobileTabBarDismissTimer();
            this.mobileTabBarDismissTimer = setPlatformTimeout(dismiss, 5000);
        };

        handle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tabOptions.classList.contains('pa-tab-bar-visible')) {
                this.clearMobileTabBarDismissTimer();
                dismiss();
            } else {
                tabOptions.classList.add('pa-tab-bar-visible');
                setIcon(handle, 'chevron-down');
                handle.setAttribute('aria-label', t("plugin.chat.mobile.hideTabBar"));
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

    private markChatDrawerHost(containerEl: HTMLElement) {
        this.clearChatDrawerHost();
        const drawerHost = containerEl.closest('.workspace-drawer-inner') as HTMLElement | null;
        if (!drawerHost) return;
        drawerHost.classList.add(CHAT_DRAWER_HOST_CLASS);
        this.chatDrawerHost = drawerHost;
    }

    private clearChatDrawerHost() {
        this.chatDrawerHost?.classList.remove(CHAT_DRAWER_HOST_CLASS);
        this.chatDrawerHost = null;
    }

    private clearMobileTabBarDismissTimer() {
        if (this.mobileTabBarDismissTimer !== null) {
            clearPlatformTimeout(this.mobileTabBarDismissTimer);
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
            containerEl.setCssProps({ '--pa-chat-status-bar-clearance': `${clearance}px` });
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

        const win = getOptionalPlatformWindow();
        if (typeof win?.addEventListener === 'function') {
            this.statusBarResizeHandler = updateClearance;
            this.statusBarResizeWindow = win;
            win.addEventListener('resize', updateClearance);
        }
    }

    private disconnectStatusBarClearance() {
        this.statusBarResizeObserver?.disconnect();
        this.statusBarResizeObserver = null;

        if (this.statusBarResizeHandler && this.statusBarResizeWindow) {
            this.statusBarResizeWindow.removeEventListener('resize', this.statusBarResizeHandler);
        }
        this.statusBarResizeHandler = null;
        this.statusBarResizeWindow = null;
    }

    private observeKeyboardClearance(containerEl: HTMLElement, inputEl: HTMLElement, onClearanceChange?: () => void) {
        this.disconnectKeyboardClearance();

        let previousClearance = -1;
        let previousAccessoryClearance = -1;
        let previousComposerHeight = -1;
        let previousSource: KeyboardClearanceSource = 'none';
        let previousKeyboardVisible = false;
        this.keyboardLayoutBaselineHeight = this.getLayoutViewportHeight();
        const applyClearance = (notify: boolean) => {
            const measurement = this.measureKeyboardClearance(containerEl, inputEl);
            const clearance = measurement.realClearance;
            if (
                clearance === previousClearance
                && measurement.accessoryClearance === previousAccessoryClearance
                && measurement.composerHeight === previousComposerHeight
                && measurement.source === previousSource
                && measurement.keyboardVisible === previousKeyboardVisible
            ) {
                return;
            }
            previousClearance = clearance;
            previousAccessoryClearance = measurement.accessoryClearance;
            previousComposerHeight = measurement.composerHeight;
            previousSource = measurement.source;
            previousKeyboardVisible = measurement.keyboardVisible;
            this.setKeyboardClearanceStyles(containerEl, clearance, measurement.keyboardVisible);
            this.syncKeyboardComposerOverlay(containerEl, clearance, measurement.accessoryClearance, measurement.composerHeight, measurement.source, measurement.keyboardVisible);
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
            this.keyboardUpdateFrame = requestPlatformAnimationFrame(updateClearance);
        };

        this.keyboardUpdateHandler = scheduleUpdate;
        this.keyboardVisualViewport = this.getVisualViewport();
        applyClearance(false);

        this.keyboardVisualViewport?.addEventListener('resize', scheduleUpdate);
        this.keyboardVisualViewport?.addEventListener('scroll', scheduleUpdate);

        this.addWindowKeyboardListener('resize', scheduleUpdate);
        this.addWindowKeyboardListener('orientationchange', scheduleUpdate);
        this.observeNativeKeyboardEvents(scheduleUpdate);
    }

    private disconnectKeyboardClearance() {
        if (this.keyboardUpdateFrame !== null) {
            cancelPlatformAnimationFrame(this.keyboardUpdateFrame);
        }
        this.keyboardUpdateFrame = null;

        if (this.keyboardUpdateHandler) {
            this.keyboardVisualViewport?.removeEventListener('resize', this.keyboardUpdateHandler);
            this.keyboardVisualViewport?.removeEventListener('scroll', this.keyboardUpdateHandler);
        }
        for (const { type, listener, target } of this.keyboardWindowListeners) {
            target.removeEventListener(type, listener);
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
        this.nativeKeyboardVisible = false;
        this.keyboardLayoutBaselineHeight = 0;
        this.setKeyboardClearanceStyles(this.containerEl, 0, false);
        this.clearKeyboardComposerOverlay(this.containerEl);
    }

    private getVisualViewport(): VisualViewport | null {
        return getOptionalPlatformWindow()?.visualViewport ?? null;
    }

    private measureKeyboardClearance(containerEl: HTMLElement, inputEl: HTMLElement): {
        realClearance: number;
        accessoryClearance: number;
        composerHeight: number;
        source: KeyboardClearanceSource;
        keyboardVisible: boolean;
    } {
        if (!containerEl.getBoundingClientRect) {
            return {
                realClearance: 0,
                accessoryClearance: 0,
                composerHeight: 0,
                source: 'none',
                keyboardVisible: false,
            };
        }

        const viewRect = containerEl.getBoundingClientRect();
        const visualViewport = this.getVisualViewport();
        const viewportOverlap = this.calculateVisualViewportKeyboardOverlap(viewRect, visualViewport);
        const nativeOverlap = this.calculateKeyboardHeightOverlap(viewRect, this.nativeKeyboardHeight);
        const realClearance = Math.max(viewportOverlap, nativeOverlap);
        const composerHeight = this.measureComposerHeight(inputEl);
        const nativeFallbackPreferred = this.nativeKeyboardVisible
            && nativeOverlap > 0
            && nativeOverlap >= viewportOverlap;
        const source = realClearance <= 0
            ? 'none'
            : nativeFallbackPreferred
                ? 'native'
                : viewportOverlap >= nativeOverlap
                    ? 'visualViewport'
                    : 'native';
        const keyboardVisible = realClearance > 0
            || this.nativeKeyboardVisible
            || this.isVisualViewportKeyboardLikelyVisible(visualViewport);
        const accessoryClearance = 0;
        if (!keyboardVisible) {
            this.refreshKeyboardLayoutBaselineHeight();
        }

        return {
            realClearance,
            accessoryClearance,
            composerHeight,
            source,
            keyboardVisible,
        };
    }

    private measureComposerHeight(inputEl: HTMLElement): number {
        const composerRect = inputEl.getBoundingClientRect?.();
        return composerRect?.height && Number.isFinite(composerRect.height)
            ? Math.ceil(composerRect.height)
            : 0;
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
        if (
            layoutHeight > 0
            && this.keyboardLayoutBaselineHeight > 0
            && layoutHeight < this.keyboardLayoutBaselineHeight - KEYBOARD_LAYOUT_RESIZE_THRESHOLD_PX
        ) {
            const residualOverlap = viewRect.bottom - layoutHeight;
            if (residualOverlap <= 1) return 0;
            return Math.ceil(Math.min(residualOverlap, viewRect.height));
        }
        if (layoutHeight <= 0) return Math.ceil(Math.min(keyboardHeight, viewRect.height));

        const keyboardTop = layoutHeight - keyboardHeight;
        const overlap = viewRect.bottom - keyboardTop;
        if (overlap <= 1) return 0;
        return Math.ceil(Math.min(overlap, keyboardHeight, viewRect.height));
    }

    private isVisualViewportKeyboardLikelyVisible(viewport: VisualViewport | null): boolean {
        if (!viewport) return false;
        const layoutHeight = this.getLayoutViewportHeight();
        const viewportBottom = viewport.offsetTop + viewport.height;
        if (!Number.isFinite(viewportBottom) || viewportBottom <= 0 || layoutHeight <= 0) return false;
        return viewportBottom < layoutHeight - 1;
    }

    private refreshKeyboardLayoutBaselineHeight() {
        const layoutHeight = this.getLayoutViewportHeight();
        if (layoutHeight > 0) {
            this.keyboardLayoutBaselineHeight = layoutHeight;
        }
    }

    private syncKeyboardComposerOverlay(
        containerEl: HTMLElement,
        clearance: number,
        accessoryClearance: number,
        composerHeight: number,
        source: KeyboardClearanceSource,
        keyboardVisible: boolean,
    ) {
        if (!keyboardVisible) {
            this.clearKeyboardComposerOverlay(containerEl);
            return;
        }

        containerEl.setCssProps({
            '--pa-chat-composer-height': `${composerHeight}px`,
            '--pa-chat-keyboard-accessory-clearance': `${accessoryClearance}px`,
        });
        containerEl.classList.add('is-keyboard-open');
        if (source === 'native' && clearance > 0) {
            containerEl.classList.add('is-keyboard-native-fallback');
        } else {
            containerEl.classList.remove('is-keyboard-native-fallback');
        }
    }

    private clearKeyboardComposerOverlay(containerEl: HTMLElement) {
        containerEl.classList.remove('is-keyboard-open');
        containerEl.classList.remove('is-keyboard-native-fallback');
        containerEl.setCssProps({
            '--pa-chat-composer-height': '0px',
            '--pa-chat-keyboard-accessory-clearance': '0px',
        });
    }

    private setKeyboardClearanceStyles(containerEl: HTMLElement, clearance: number, keyboardVisible: boolean) {
        // When JS has measured a real overlap (visualViewport or Capacitor keyboard event),
        // pin the explicit pixel value. A visible keyboard with no residual overlap gets an
        // explicit zero so the mobile spacer does not consume env(keyboard-inset-height).
        // Once the keyboard is closed, reset to the CSS env() fallback for the next show.
        if (clearance > 0) {
            containerEl.setCssProps({
                '--pa-chat-keyboard-clearance': `${clearance}px`,
                '--pa-chat-keyboard-offset': `-${clearance}px`,
            });
        } else if (keyboardVisible) {
            containerEl.setCssProps({
                '--pa-chat-keyboard-clearance': '0px',
                '--pa-chat-keyboard-offset': '0px',
            });
        } else {
            containerEl.setCssProps({
                '--pa-chat-keyboard-clearance': 'env(keyboard-inset-height, 0px)',
                '--pa-chat-keyboard-offset': 'calc(0px - env(keyboard-inset-height, 0px))',
            });
        }
    }

    private getLayoutViewportHeight(): number {
        const win = getOptionalPlatformWindow();
        if (Number.isFinite(win?.innerHeight) && (win?.innerHeight ?? 0) > 0) {
            return win?.innerHeight ?? 0;
        }
        const doc = getOptionalPlatformDocument();
        return doc?.documentElement?.clientHeight
            ?? doc?.body?.clientHeight
            ?? 0;
    }

    private observeNativeKeyboardEvents(scheduleUpdate: () => void) {
        const handleShow = (source: unknown) => {
            const keyboardHeight = this.readKeyboardHeight(source);
            this.nativeKeyboardVisible = true;
            if (keyboardHeight > 0) {
                this.nativeKeyboardHeight = keyboardHeight;
            }
            scheduleUpdate();
        };
        const handleHide = () => {
            this.nativeKeyboardVisible = false;
            this.nativeKeyboardHeight = 0;
            scheduleUpdate();
        };

        this.addWindowKeyboardListener('keyboardWillShow', handleShow);
        this.addWindowKeyboardListener('keyboardDidShow', handleShow);
        this.addWindowKeyboardListener('keyboardWillHide', handleHide);
        this.addWindowKeyboardListener('keyboardDidHide', handleHide);

        const keyboardPlugin = this.getNativeKeyboardPlugin();
        if (!keyboardPlugin?.addListener) return;
        // Let Capacitor resize the layout viewport; native events only provide fallback
        // keyboard height when the viewport has not reflected the keyboard yet.
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
        const win = getOptionalPlatformWindow();
        if (typeof win?.addEventListener !== 'function') return;
        const eventListener: EventListener = (event) => listener(event);
        win.addEventListener(type, eventListener);
        this.keyboardWindowListeners.push({ type, listener: eventListener, target: win });
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
        const doc = getOptionalPlatformDocument();
        if (!doc) return null;
        return doc.body?.querySelector<HTMLElement>('.status-bar') ?? null;
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
            cancelPlatformAnimationFrame(this.scheduledScrollFrame);
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
                    new Notice(pluginT("plugin.chat.notice.openNoteFailed", getPluginUiLanguage(), { note: noteHref }), 4000);
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
            this.plugin.scheduleMemoryExtractionAfterChatTurn?.(conversationId, updated.turnCount);
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
