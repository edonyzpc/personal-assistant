import { WorkspaceLeaf, MarkdownView, Notice, ItemView, MarkdownRenderer, Vault, setIcon, Modal, Setting, type EventRef } from 'obsidian';
import { ChatService, type ChatAgentStatus, type ChatTurnMemoryMetadata } from './ai-services/chat-service';
import type PluginManager from "./main";
import { VSS } from './vss'
import { isPluginEnabled } from './utils';
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
    toggleButton: HTMLButtonElement;
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

interface MemoryReferenceMatch {
    paths: string[];
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
    private memoryStatusUnsubscribe: (() => void) | null = null;
    private memorySourceBarId = 0;

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

        const composerHint = inputDiv.createDiv({ cls: 'pa-chat-composer-hint' });
        composerHint.hidden = true;
        composerHint.setAttribute('aria-live', 'polite');

        const buttonDiv = inputDiv.createDiv({ cls: 'llm-buttons pa-chat-composer-actions' });
        const composerMenu = inputDiv.createDiv({ cls: 'pa-chat-menu pa-chat-composer-menu' });
        composerMenu.hidden = true;
        const copyConversationButton = composerMenu.createEl('button', {
            text: 'Copy conversation',
            cls: 'pa-chat-menu-item',
            attr: { type: 'button' },
        });
        const clearButton = composerMenu.createEl('button', {
            text: 'Clear Chat',
            cls: 'pa-chat-menu-item pa-chat-menu-item-danger',
            attr: { type: 'button' },
        });
        const technicalMemoryButton = composerMenu.createEl('button', {
            text: 'Show technical Memory status',
            cls: 'pa-chat-menu-item',
            attr: { type: 'button' },
        });
        const settingsButton = composerMenu.createEl('button', {
            text: 'Open settings',
            cls: 'pa-chat-menu-item',
            attr: { type: 'button' },
        });
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
        const moreButton = buttonDiv.createEl('button', {
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
            contentDiv: HTMLElement;
            renderToken: number;
            copyContent: string;
            memoryMetadata?: ChatTurnMemoryMetadata;
        };
        type UiTurn = {
            id: number;
            prompt: string;
            memoryMetadata?: ChatTurnMemoryMetadata;
            userMessage?: RenderedMessage;
            assistantMessage?: RenderedMessage;
            statusView?: ThinkingStatusView;
            terminalRow?: HTMLDivElement;
        };
        type HistoryTurnEntry = {
            kind: 'history';
            user: ChatMessage;
            assistant: ChatMessage;
            memoryMetadata?: ChatTurnMemoryMetadata;
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
            memoryMenu.createDiv({ cls: 'pa-chat-menu-label', text: state.label });
            if (state.actionLabel && state.actionKind) {
                const actionButton = memoryMenu.createEl('button', {
                    text: state.actionLabel,
                    cls: 'pa-chat-menu-item pa-chat-memory-action',
                    attr: { type: 'button' },
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
            const openSettingsButton = memoryMenu.createEl('button', {
                text: 'Open settings',
                cls: 'pa-chat-menu-item',
                attr: { type: 'button' },
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
            const technicalButton = memoryMenu.createEl('button', {
                text: 'Show technical Memory status',
                cls: 'pa-chat-menu-item',
                attr: { type: 'button' },
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
        const parseMemoryReferences = (content: string): MemoryReferenceMatch | null => {
            const match = content.match(/\n+---\s*\n>\s*\[!personal-assistant-ai\]-\s*(Memory references|RAG Referenc(?:es?)?)\b([\s\S]*)$/i);
            if (!match) return null;
            const block = match[2] ?? "";
            const paths = [...block.matchAll(/\[\[([^\]]+)\]\]/g)]
                .map((linkMatch) => linkMatch[1].split('|')[0].split('#')[0].trim())
                .filter(Boolean);
            return { paths: [...new Set(paths)] };
        };
        const removeRenderedMemoryReferenceCallout = (buffer: HTMLElement): boolean => {
            const callouts = Array.from(buffer.querySelectorAll('.callout[data-callout="personal-assistant-ai"]')) as HTMLElement[];
            const referenceCallout = callouts.find((callout) =>
                /Memory references|RAG Referenc(?:es?)?/i.test(callout.textContent ?? '')
            ) ?? (callouts.length === 1 ? callouts[0] : null);
            if (!referenceCallout?.parentElement) return false;
            referenceCallout.parentElement.removeChild(referenceCallout);
            return true;
        };
        const createMemorySourceBar = (contentDiv: HTMLElement, paths: string[]) => {
            const sourceBar = contentDiv.createDiv({ cls: 'pa-chat-source-bar' });
            const detailsId = `pa-chat-memory-sources-${sessionId}-${++this.memorySourceBarId}`;
            const toggleButton = sourceBar.createEl('button', {
                cls: 'pa-chat-source-toggle',
                attr: {
                    type: 'button',
                    'aria-expanded': 'false',
                    'aria-controls': detailsId,
                },
            });
            setIcon(toggleButton, 'chevron-right');
            toggleButton.createSpan({ text: `Memory used (${paths.length})` });
            const sourceList = sourceBar.createDiv({ cls: 'pa-chat-source-list' });
            sourceList.id = detailsId;
            sourceList.hidden = true;
            paths.forEach((path) => {
                const link = sourceList.createEl('a', {
                    text: path,
                    cls: 'pa-chat-source-link internal-link',
                    attr: { href: path },
                });
                link.setAttribute('data-href', path);
            });
            this.updateClickableLink(sourceBar);
            toggleButton.onclick = () => {
                sourceList.hidden = !sourceList.hidden;
                const expanded = !sourceList.hidden;
                toggleButton.setAttribute('aria-expanded', String(expanded));
                setIcon(toggleButton, expanded ? 'chevron-down' : 'chevron-right');
            };
        };
        const transformMemoryReferences = (
            rendered: RenderedMessage,
            content: string,
            buffer: HTMLElement,
        ) => {
            try {
                const references = parseMemoryReferences(content);
                if (!references || references.paths.length === 0) return;
                const metadata = rendered.memoryMetadata;
                if (!metadata?.hasMemoryContent) return;
                const allowedPaths = new Set(metadata.allowedMemorySourcePaths);
                if (!references.paths.every((path) => allowedPaths.has(path))) return;
                if (!removeRenderedMemoryReferenceCallout(buffer)) return;
                createMemorySourceBar(rendered.contentDiv, references.paths);
            } catch (error) {
                this.plugin.log?.("Could not transform Memory references", error);
            }
        };

        const renderMarkdownInto = (
            rendered: RenderedMessage,
            content: string,
            isLive: () => boolean,
            forceScroll = false,
        ) => {
            rendered.renderToken += 1;
            rendered.copyContent = content;
            const renderToken = rendered.renderToken;
            const buffer = createRenderBuffer();
            buffer.classList.add('message-render-buffer');

            void Promise.resolve(MarkdownRenderer.render(this.plugin.app, content, buffer, '', this.plugin))
                .then(() => {
                    if (rendered.renderToken !== renderToken || !isLive()) {
                        removeElement(buffer);
                        return;
                    }
                    rendered.contentDiv.empty();
                    rendered.contentDiv.appendChild(buffer);
                    this.updateClickableLink(buffer);
                    transformMemoryReferences(rendered, content, buffer);
                    scrollToBottom({ force: forceScroll, behavior: forceScroll ? 'smooth' : 'auto' });
                })
                .catch((error) => {
                    if (rendered.renderToken !== renderToken || !isLive()) return;
                    buffer.setText(`Could not render message: ${String(error)}`);
                    rendered.contentDiv.empty();
                    rendered.contentDiv.appendChild(buffer);
                    scrollToBottom({ force: forceScroll, behavior: 'auto' });
                });
        };

        const createMessageElement = (
            message: ChatMessage,
            options: {
                forceScroll?: boolean;
                isLive?: () => boolean;
                onDelete?: () => void | Promise<void>;
                onAddToEditor?: (content: string) => void | Promise<void>;
                disableDeleteWhileGenerating?: boolean;
                memoryMetadata?: ChatTurnMemoryMetadata;
            } = {},
        ): RenderedMessage => {
            const messageDiv = this.responseDiv.createDiv({ cls: `llm-message ${message.role}` });
            messageDiv.createDiv({ cls: 'message-role', text: message.role === 'user' ? 'You' : 'Assistant' });
            const contentDiv = messageDiv.createDiv({ cls: 'message-content' }) as HTMLElement;
            const actionDiv = messageDiv.createDiv({ cls: 'message-actions' });
            const rendered: RenderedMessage = {
                messageDiv,
                contentDiv,
                renderToken: 0,
                copyContent: message.content,
                memoryMetadata: options.memoryMetadata,
            };
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
            actionMenu.hidden = true;
            const actionMenuAutoClose = createIdleMenuAutoClose(actionMenu, menuButton, () => {
                actionMenu.hidden = true;
                menuButton.setAttribute('aria-expanded', 'false');
            });
            menuButton.onclick = () => {
                if (actionMenu.hidden) {
                    actionMenu.hidden = false;
                    menuButton.setAttribute('aria-expanded', 'true');
                    actionMenuAutoClose.schedule();
                } else {
                    actionMenuAutoClose.close();
                }
            };
            const copyButton = actionMenu.createEl('button', {
                text: 'Copy',
                cls: 'pa-chat-menu-item copy-message-button',
                attr: { type: 'button' },
            });
            copyButton.onclick = () => {
                navigator.clipboard.writeText(rendered.copyContent).then(() => {
                    new Notice('Copied to clipboard');
                }).catch(err => {
                    console.error('Could not copy text: ', err);
                });
            };

            if (message.role === 'assistant' && options.onAddToEditor) {
                const addMessageButton = actionMenu.createEl('button', {
                    text: 'Add to Editor',
                    cls: 'pa-chat-menu-item add-to-editor-message-button',
                    attr: { type: 'button' },
                });
                addMessageButton.onclick = () => {
                    void options.onAddToEditor?.(rendered.copyContent);
                };
            }

            if (options.onDelete) {
                const deleteButton = actionMenu.createEl('button', {
                    text: 'Delete',
                    cls: 'pa-chat-menu-item pa-chat-menu-item-danger delete-message-button',
                    attr: { type: 'button' },
                });
                deleteButton.disabled = Boolean(options.disableDeleteWhileGenerating && isGenerating());
                deleteButton.onclick = () => {
                    if (deleteButton.disabled) return;
                    void options.onDelete?.();
                };
                if (options.disableDeleteWhileGenerating) {
                    historyDeleteButtons.push(deleteButton);
                }
            }

            renderMarkdownInto(rendered, message.content, options.isLive ?? (() => true), options.forceScroll);
            return rendered;
        };

        const deleteHistoryPair = async (messageIndex: number) => {
            if (isGenerating()) return;
            const pairStart = messageIndex % 2 === 0 ? messageIndex : messageIndex - 1;
            if (pairStart < 0 || pairStart >= this.chatHistory.length) return;
            const expectedUser = this.chatHistory[pairStart];
            const expectedAssistant = this.chatHistory[pairStart + 1];
            const confirmed = await confirmChatAction(this.plugin, {
                title: 'Delete message?',
                message: 'This deletes the full user and assistant turn from this chat.',
                confirmText: 'Delete',
                danger: true,
            });
            if (!confirmed) return;
            if (!isCurrentSession()) return;
            if (isGenerating()) return;
            if (pairStart < 0 || pairStart >= this.chatHistory.length) return;
            if (this.chatHistory[pairStart] !== expectedUser || this.chatHistory[pairStart + 1] !== expectedAssistant) return;
            this.chatHistory.splice(pairStart, 2);
            timelineEntries = timelineEntries.filter((entry) =>
                entry.kind !== 'history' || entry.user !== expectedUser || entry.assistant !== expectedAssistant
            );
            renderTimeline();
            new Notice('Message deleted');
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
            row.createDiv({ cls: 'message-role', text: entry.terminalKind === 'error' ? 'Error' : 'Cancelled' });
            row.createDiv({ cls: 'message-content', text: entry.content });
            const actions = row.createDiv({ cls: 'message-actions turn-terminal-actions' });
            const retryButton = actions.createEl('button', {
                cls: 'message-action-button retry-message-button',
                attr: { 'aria-label': 'Retry message' },
            });
            retryButton.setText('Retry');
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

        const createThinkingStatusView = (): ThinkingStatusView => {
            const messageDiv = this.responseDiv.createDiv({ cls: 'llm-message system thinking-status' });
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
            headerDiv.createDiv({ cls: 'message-role thinking-status-role', text: 'Thinking' });
            const summaryEl = headerDiv.createDiv({ cls: 'thinking-status-summary' });
            summaryEl.setAttribute('aria-live', 'polite');
            const detailsEl = messageDiv.createDiv({ cls: 'thinking-status-details' });
            detailsEl.id = detailsId;
            detailsEl.hidden = true;

            const statusView: ThinkingStatusView = {
                messageDiv,
                summaryEl,
                detailsEl,
                toggleButton,
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
                const detailItem = statusView.detailsEl.createDiv({ cls: 'thinking-status-detail-item', text: content });
                statusView.detailItems.push(detailItem);
                while (statusView.detailItems.length > MAX_THINKING_DETAIL_ITEMS) {
                    removeElement(statusView.detailItems.shift());
                }
            }
            scrollToBottom();
        };

        const formatAgentStatus = (status: ChatAgentStatus): string => {
            if (status.type === 'thinking') {
                return 'Deciding what context to use...';
            } else if (status.type === 'memory-prefetching') {
                return `Searching notes: ${status.query}`;
            } else if (status.type === 'memory-prefetched') {
                const sources = status.sources
                    .slice(0, 4)
                    .map((source) => source.path)
                    .join(', ');
                return sources ? `Related notes found: ${sources}` : 'No related memory';
            } else if (status.type === 'retrieving') {
                return `Searching notes: ${status.query}`;
            } else if (status.type === 'retrieved') {
                const sources = status.sources
                    .slice(0, 4)
                    .map((source) => source.path)
                    .join(', ');
                return sources ? `Related notes found: ${sources}` : 'No related memory';
            } else if (status.type === 'memory-skipped') {
                return /returned 0 source/i.test(status.reason) ? 'No related memory' : 'Memory skipped';
            } else if (status.type === 'tool-running') {
                return status.message;
            } else if (status.type === 'tool-done') {
                const sources = status.sources
                    ?.slice(0, 4)
                    .map((source) => source.path)
                    .join(', ');
                return sources ? `${status.message}: ${sources}` : status.message;
            } else if (status.type === 'tool-skipped') {
                return status.reason;
            } else if (status.type === 'answering') {
                return 'Answering...';
            } else if (status.type === 'fallback') {
                return 'I will answer normally this time.';
            }
            return 'Thinking...';
        };

        const renderAgentStatus = (turn: UiTurn, status: ChatAgentStatus) => {
            turn.statusView ??= createThinkingStatusView();
            appendThinkingStatus(turn.statusView, formatAgentStatus(status));
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
            };
            const isUiTurnVisible = () => isCurrentSession()
                && this.activeTurnId === turnId
                && Boolean(turn.userMessage?.messageDiv.parentElement);

            try {
                turn.userMessage = createMessageElement(
                    { role: 'user', content: prompt },
                    { forceScroll: true, isLive: isUiTurnVisible },
                );
                textArea.value = '';
                hideComposerHint();
                setHistoryDeleteButtonsDisabled(true);
                syncComposerControls();
                let responseContent = '';

                await this.chatService.streamLLM(
                    prompt,
                    (chunk) => {
                        if (!isLiveTurn()) return;
                        responseContent = chunk;
                        if (!turn.assistantMessage) {
                            turn.assistantMessage = createMessageElement(
                                { role: 'assistant', content: responseContent },
                                { isLive: isLiveTurn, memoryMetadata: turn.memoryMetadata },
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
                        onStatus: (status) => {
                            if (!isLiveTurn()) return;
                            renderAgentStatus(turn, status);
                        },
                        onTurnMetadata: (metadata) => {
                            if (!isSameTurn()) return;
                            turn.memoryMetadata = metadata;
                            if (turn.assistantMessage) {
                                turn.assistantMessage.memoryMetadata = metadata;
                            }
                        },
                    },
                );

                if (!isLiveTurn()) return;
                const userMessage: ChatMessage = { role: 'user', content: prompt };
                const assistantMessage: ChatMessage = { role: 'assistant', content: responseContent };
                this.chatHistory.push(userMessage, assistantMessage);
                timelineEntries.push({
                    kind: 'history',
                    user: userMessage,
                    assistant: assistantMessage,
                    memoryMetadata: turn.memoryMetadata,
                });
                this.result = responseContent;
                renderTimeline();

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

        moreButton.onclick = () => {
            const willOpen = composerMenu.hidden;
            if (willOpen) {
                closeMemoryMenu();
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
                closeMemoryMenu();
                return;
            }
            const requestId = ++memoryMenuRequestId;
            void renderMemoryMenu().then(() => {
                if (!isCurrentSession() || requestId !== memoryMenuRequestId) return;
                memoryMenu.hidden = false;
                memoryChip.setAttribute('aria-expanded', 'true');
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
        this.disconnectMemoryStatusListener();
    }

    private startViewSession(): number {
        this.cancelScheduledScroll();
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
        const getNoteUri = (vault: Vault, noteHref: string) => {
            if (isPluginEnabled(this.plugin.app, "obsidian-advanced-uri")) {
                // Use Advanced URI plugin if it is enabled.
                // obsidian://advanced-uri?vault=<your-vault>&filepath=my-file
                return [
                    "obsidian://advanced-uri?vault=",
                    encodeURIComponent(vault.getName()),
                    "&filepath=",
                    encodeURIComponent(noteHref),
                    "&openmode=true",
                ].join("");
            } else {
                // Use Obsidian default URI
                return [
                    "obsidian://open?vault=",
                    encodeURIComponent(vault.getName()),
                    "&file=",
                    encodeURIComponent(noteHref)
                ].join("");
            }
        };

        const links = containerEl.querySelectorAll("a.internal-link");
        links.forEach((node) => {
            if (!node.getAttribute("href")) {
                return;
            }
            const link = node as HTMLLinkElement;
            // prevents click event from parent element other than the current link element
            link.addEventListener("click", (evt) => {
                evt.stopPropagation();
            });
            // do not change the hyperlink if it is changed
            if (link.href.startsWith("obsidian://")) return;
            link.href = getNoteUri(
                this.plugin.app.vault,
                link.getAttribute("href") as string,
            );
        });
    }
}
