import { Modal, Setting } from 'obsidian';
import type PluginManager from '../main';
import type { PersistedConversation } from './chat-history-store';
import { getPluginUiLanguage, makePluginTranslator, type PluginTranslator } from '../locales/plugin';
import { getOptionalPlatformDocument } from '../platform-dom';

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
                    .setButtonText(this.options.cancelText ?? makePluginTranslator(getPluginUiLanguage())("plugin.chat.action.cancel"))
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
    if (!getOptionalPlatformDocument()) {
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
        const t = makePluginTranslator(getPluginUiLanguage());
        (this as unknown as { modalEl?: HTMLElement }).modalEl?.addClass('pa-chat-history-modal-shell');
        contentEl.empty();
        contentEl.addClass('pa-chat-history-modal');
        contentEl.createEl('h2', { text: t("plugin.chat.history.title") });
        if (this.options.isStreaming) {
            contentEl.createEl('p', {
                text: t("plugin.chat.notice.waitForSwitch"),
                cls: 'pa-chat-history-warning',
            });
        }
        if (this.options.conversations.length === 0) {
            contentEl.createEl('p', { text: t("plugin.chat.history.empty") });
            new Setting(contentEl).addButton((button) => {
                button.setButtonText(t("plugin.chat.action.close")).onClick(() => this.resolve(null));
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
                title.createSpan({ cls: 'pa-chat-history-active-badge', text: t("plugin.chat.history.currentBadge") });
            }
            const preview = getDistinctChatHistoryPreview(conversation.title, conversation.preview);
            if (preview) {
                button.createEl('div', { cls: 'pa-chat-history-preview', text: preview });
            }
            button.createEl('div', {
                cls: 'pa-chat-history-meta',
                text: `${formatTurnCount(conversation.turnCount, t)} · ${formatRelativeTime(conversation.updatedAt, t)}`,
            });
            button.onclick = () => {
                if (this.options.isStreaming) return;
                this.resolve({ action: 'open', conversationId: conversation.id });
            };
            const deleteButton = item.createEl('button', {
                cls: 'pa-chat-history-delete',
                attr: {
                    type: 'button',
                    'aria-label': t("plugin.chat.history.deleteConversation"),
                    title: t("plugin.chat.history.deleteConversation"),
                },
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
            button.setButtonText(t("plugin.chat.action.close")).onClick(() => this.resolve(null));
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
    if (!getOptionalPlatformDocument()) {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        new ChatHistoryPickerModal(plugin, options, resolve).open();
    });
}

function formatTurnCount(count: number, t: PluginTranslator): string {
    return t(count === 1 ? "plugin.chat.history.turn" : "plugin.chat.history.turns", { count });
}

function formatRelativeTime(iso: string, t: PluginTranslator): string {
    const timestamp = Date.parse(iso);
    if (Number.isNaN(timestamp)) return iso;
    const deltaMs = Date.now() - timestamp;
    if (deltaMs < 60_000) return t("plugin.chat.history.justNow");
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 60) return t("plugin.chat.history.minAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("plugin.chat.history.hrAgo", { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t(days === 1 ? "plugin.chat.history.dayAgo" : "plugin.chat.history.daysAgo", { count: days });
    return new Date(timestamp).toLocaleDateString();
}

export function getDistinctChatHistoryPreview(title: string, preview: string): string {
    const normalizedPreview = normalizeChatHistorySummary(preview);
    if (!normalizedPreview) return '';

    const normalizedTitle = normalizeChatHistorySummary(title);
    if (!normalizedTitle) return normalizedPreview;

    const titlePrefix = normalizedTitle.replace(/[.…]+$/u, '').trim();
    if (
        normalizedPreview === normalizedTitle
        || normalizedPreview === titlePrefix
        || (titlePrefix.length >= 24 && normalizedPreview.startsWith(titlePrefix))
    ) {
        return '';
    }
    return normalizedPreview;
}

function normalizeChatHistorySummary(value: string): string {
    return (value ?? '').trim().replace(/\s+/g, ' ');
}
