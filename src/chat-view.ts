import { WorkspaceLeaf, MarkdownView, Notice, ItemView, MarkdownRenderer, Vault, setIcon, Modal, Setting } from 'obsidian';
import { ChatService, type ChatAgentStatus } from './ai-services/chat-service';
import type PluginManager from "./main";
import { VSS } from './vss'
import { isPluginEnabled } from './utils';

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

        const chatContainer = containerEl.createDiv({ cls: 'llm-chat-container' });

        const inputDiv = containerEl.createDiv({ cls: 'llm-input' });
        const composerRow = inputDiv.createDiv({ cls: 'pa-chat-composer-row' });
        const memoryChip = composerRow.createEl('button', {
            cls: 'pa-chat-memory-chip',
            attr: {
                type: 'button',
                'aria-label': 'Show Memory status',
                title: 'Show Memory status',
            },
        });
        setIcon(memoryChip, 'brain');
        memoryChip.createSpan({ text: 'Memory' });
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
        const addToEditorButton = buttonDiv.createEl('button', { text: 'Add to Editor' });
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

        addToEditorButton.disabled = true;
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
        };
        type UiTurn = {
            id: number;
            prompt: string;
            userMessage?: RenderedMessage;
            assistantMessage?: RenderedMessage;
            statusView?: ThinkingStatusView;
            terminalRow?: HTMLDivElement;
        };
        type HistoryTurnEntry = {
            kind: 'history';
            user: ChatMessage;
            assistant: ChatMessage;
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
                getMostRecentLeaf?: () => WorkspaceLeaf | null;
                getLeavesOfType?: (type: string) => WorkspaceLeaf[];
            };
            const mostRecentLeaf = workspace.getMostRecentLeaf?.();
            if (mostRecentLeaf?.view instanceof MarkdownView) return true;
            return Boolean(workspace.getLeavesOfType?.('markdown')?.some((leaf) => leaf.view instanceof MarkdownView));
        };
        const fillComposer = (prompt: string) => {
            textArea.value = prompt;
            hideComposerHint();
            syncComposerControls();
            textArea.focus();
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
            menuButton.onclick = () => {
                actionMenu.hidden = !actionMenu.hidden;
                menuButton.setAttribute('aria-expanded', String(!actionMenu.hidden));
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
            addToEditorButton.disabled = !this.result;
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
                return `Finding related memory: ${status.query}`;
            } else if (status.type === 'memory-prefetched') {
                const sources = status.sources
                    .slice(0, 4)
                    .map((source) => source.path)
                    .join(', ');
                return sources ? `Found memory references: ${sources}` : 'No related memory found.';
            } else if (status.type === 'retrieving') {
                return `Searching memory: ${status.query}`;
            } else if (status.type === 'retrieved') {
                const sources = status.sources
                    .slice(0, 4)
                    .map((source) => source.path)
                    .join(', ');
                return sources ? `Found memory references: ${sources}` : 'No memory references found.';
            } else if (status.type === 'memory-skipped') {
                return status.reason;
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
                const reason = status.reason ? ` Reason: ${status.reason}` : '';
                return `I could not use the planner this time, so I will answer with a fallback path.${reason}`;
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
                addToEditorButton.disabled = true;
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
                                { isLive: isLiveTurn },
                            );
                        } else {
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
                });
                this.result = responseContent;
                renderTimeline();

            } catch (error) {
                if (!isSameTurn()) return;
                if (error instanceof DOMException && error.name === 'AbortError') {
                    createTerminalEntry(turn, 'Generation cancelled', 'cancelled');
                    this.result = previousResult;
                    addToEditorButton.disabled = !this.result;
                } else {
                    createTerminalEntry(turn, 'The answer did not finish.', 'error', String(error));
                    this.result = previousResult;
                    addToEditorButton.disabled = !this.result;
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
            addToEditorButton.disabled = true;
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

        addToEditorButton.onclick = async () => {
            await addContentToEditor(this.result);
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

        moreButton.onclick = () => {
            composerMenu.hidden = !composerMenu.hidden;
            moreButton.setAttribute('aria-expanded', String(!composerMenu.hidden));
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
            void this.plugin.showTechnicalMemoryStatus?.();
        };

        syncComposerControls();
        renderEmptyState();

        // vss cache updates are now handled globally in the plugin
    }

    async onClose() {
        this.viewSessionId += 1;
        this.invalidateActiveTurn();
        this.cancelScheduledScroll();
        this.panelResizeObserver?.disconnect();
        this.panelResizeObserver = null;
    }

    private startViewSession(): number {
        this.cancelScheduledScroll();
        this.viewSessionId += 1;
        return this.viewSessionId;
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
