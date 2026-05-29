import { Modal, Setting } from 'obsidian';
import type PluginManager from '../main';
import type { PersistedConversation } from './chat-history-store';

export interface ChatConfirmationOptions {
    title: string;
    message: string;
    confirmText: string;
    cancelText?: string;
    danger?: boolean;
}

export class ChatConfirmationModal extends Modal {
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

export function confirmChatAction(plugin: PluginManager, options: ChatConfirmationOptions): Promise<boolean> {
    if (typeof document === 'undefined') {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        new ChatConfirmationModal(plugin, options, resolve).open();
    });
}

export interface ChatHistoryPickerOptions {
    conversations: PersistedConversation[];
    activeConversationId: string | null;
    isStreaming: boolean;
}

export interface ChatHistoryPickerSelection {
    action: 'open' | 'delete';
    conversationId: string;
}

export class ChatHistoryPickerModal extends Modal {
    private resolved = false;

    constructor(
        plugin: PluginManager,
        private readonly options: ChatHistoryPickerOptions,
        private readonly onResolve: (selection: ChatHistoryPickerSelection | null) => void,
    ) {
        super(plugin.app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('pa-chat-history-modal');
        contentEl.createEl('h2', { text: 'Chat history' });
        if (this.options.isStreaming) {
            contentEl.createEl('p', {
                text: 'Wait for the current response to finish before switching conversations.',
                cls: 'pa-chat-history-warning',
            });
        }
        if (this.options.conversations.length === 0) {
            contentEl.createEl('p', { text: 'No saved conversations yet.' });
            new Setting(contentEl).addButton((button) => {
                button.setButtonText('Close').onClick(() => this.resolve(null));
            });
            return;
        }
        const list = contentEl.createEl('ul', { cls: 'pa-chat-history-list' });
        for (const conversation of this.options.conversations) {
            const item = list.createEl('li', { cls: 'pa-chat-history-item' });
            if (conversation.id === this.options.activeConversationId) {
                item.addClass('is-active');
            }
            const button = item.createEl('button', {
                cls: 'pa-chat-history-open',
                attr: { type: 'button' },
            });
            button.disabled = this.options.isStreaming;
            const title = button.createEl('div', { cls: 'pa-chat-history-title', text: conversation.title });
            if (conversation.id === this.options.activeConversationId) {
                title.createSpan({ cls: 'pa-chat-history-active-badge', text: ' (current)' });
            }
            if (conversation.preview) {
                button.createEl('div', { cls: 'pa-chat-history-preview', text: conversation.preview });
            }
            button.createEl('div', {
                cls: 'pa-chat-history-meta',
                text: `${conversation.turnCount} turn${conversation.turnCount === 1 ? '' : 's'} · ${formatRelativeTime(conversation.updatedAt)}`,
            });
            button.onclick = () => {
                if (this.options.isStreaming) return;
                this.resolve({ action: 'open', conversationId: conversation.id });
            };
            const deleteButton = item.createEl('button', {
                cls: 'pa-chat-history-delete',
                attr: { type: 'button', 'aria-label': 'Delete conversation', title: 'Delete conversation' },
                text: '×',
            });
            deleteButton.disabled = this.options.isStreaming;
            deleteButton.onclick = (event) => {
                event.stopPropagation();
                if (this.options.isStreaming) return;
                this.resolve({ action: 'delete', conversationId: conversation.id });
            };
        }
        new Setting(contentEl).addButton((button) => {
            button.setButtonText('Close').onClick(() => this.resolve(null));
        });
    }

    onClose() {
        this.resolve(null);
    }

    private resolve(selection: ChatHistoryPickerSelection | null) {
        if (this.resolved) return;
        this.resolved = true;
        this.onResolve(selection);
        this.close();
    }
}

export function pickChatConversation(
    plugin: PluginManager,
    options: ChatHistoryPickerOptions,
): Promise<ChatHistoryPickerSelection | null> {
    if (typeof document === 'undefined') {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        new ChatHistoryPickerModal(plugin, options, resolve).open();
    });
}

function formatRelativeTime(iso: string): string {
    const timestamp = Date.parse(iso);
    if (Number.isNaN(timestamp)) return iso;
    const deltaMs = Date.now() - timestamp;
    if (deltaMs < 60_000) return 'just now';
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(timestamp).toLocaleDateString();
}
