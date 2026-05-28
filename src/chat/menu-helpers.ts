import { setIcon } from 'obsidian';

export const CHAT_MENU_IDLE_CLOSE_MS = 8000;

export function createChatMenuItem(
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

export function createChatMenuDivider(parent: HTMLElement) {
    parent.createDiv({ cls: 'pa-chat-menu-divider' });
}

export function createChatMenuLabel(parent: HTMLElement, text: string, icon: string) {
    const label = parent.createDiv({ cls: 'pa-chat-menu-label' });
    const iconEl = label.createSpan({ cls: 'pa-chat-menu-label-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setIcon(iconEl, icon);
    label.createSpan({ cls: 'pa-chat-menu-label-text', text });
    return label;
}
